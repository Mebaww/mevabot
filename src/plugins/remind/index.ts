// Reminder management plugin: clean notifications with Done & Snooze actions
import { InlineKeyboard } from 'grammy';
import type { Bot }       from 'grammy';
import {
  addReminder,
  getPendingReminders,
  getDueReminders,
  markReminderNotified,
  deleteReminder,
  snoozeReminder,
  getReminderById,
  parseDuration,
  parseTargetTime,
  parseReminderInput,
  formatDueTime,
  formatRelativeTime,
} from '../../services/reminders.js';
import { setPendingAction, clearPendingAction } from '../../services/userState.js';
import { replySafe, markdownToTelegramHtml } from '../../utils/format.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { Plugin } from '../../types/plugin.js';

let poller: NodeJS.Timeout | null = null;

function startScheduler(bot: Bot): void {
  if (poller) return;

  poller = setInterval(async () => {
    try {
      const due = getDueReminders();
      for (const item of due) {
        markReminderNotified(item.id);

        const keyboard = new InlineKeyboard()
          .text('Done', `remind_done:${item.id}`)
          .text('Snooze 15m', `remind_snooze:${item.id}:900`);

        const text = `**Reminder**\n${item.text}`;

        await bot.api.sendMessage(item.user_id, markdownToTelegramHtml(text), {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }).catch((err) => {
          logger.error('Failed to send reminder notification', {
            id: item.id,
            error: (err as Error).message,
          });
        });
      }
    } catch (err: unknown) {
      logger.error('Reminder scheduler loop error', { error: (err as Error).message });
    }
  }, 10_000);
}

export const remindPlugin: Plugin = {
  name: 'remind',
  init(bot) {
    startScheduler(bot);

    // 1-Tap "Done" action on alarm card
    bot.callbackQuery(/^remind_done:(\d+)$/, async (ctx) => {
      const id = parseInt(ctx.match[1], 10);
      deleteReminder(ctx.from.id, id);
      await ctx.answerCallbackQuery({ text: 'Completed' });

      const currentText = ctx.callbackQuery.message?.text?.replace(/^Reminder\n?/, '') || '';
      await ctx.editMessageText(
        markdownToTelegramHtml(`Completed: ~~${currentText}~~`),
        { parse_mode: 'HTML' },
      ).catch(() => {});
    });

    // 1-Tap "Snooze 15m" action on alarm card
    bot.callbackQuery(/^remind_snooze:(\d+):(\d+)$/, async (ctx) => {
      const id = parseInt(ctx.match[1], 10);
      const seconds = parseInt(ctx.match[2], 10);
      snoozeReminder(id, seconds);

      const newTime = formatDueTime(Date.now() + seconds * 1000);
      await ctx.answerCallbackQuery({ text: `Snoozed until ${newTime}` });

      const currentText = ctx.callbackQuery.message?.text?.replace(/^Reminder\s*\(.*?\)\n?|^Reminder\n?/, '') || '';
      await ctx.editMessageText(
        markdownToTelegramHtml(`**Reminder** (snoozed until ${newTime})\n${currentText}`),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('Done', `remind_done:${id}`)
            .text('Snooze 15m', `remind_snooze:${id}:900`),
        },
      ).catch(() => {});
    });

    // 1-Tap "Cancel" action from /reminders list
    bot.callbackQuery(/^remind_cancel:(\d+)$/, async (ctx) => {
      const id = parseInt(ctx.match[1], 10);
      deleteReminder(ctx.from.id, id);
      await ctx.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.editMessageText('Reminder cancelled.').catch(() => {});
    });

    // Cancel action when in interactive reminder flow
    bot.callbackQuery('remind_cancel_to_menu', async (ctx) => {
      clearPendingAction(ctx.from.id);
      await ctx.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.editMessageText(
        markdownToTelegramHtml('Action cancelled.\n\nType /help to see available commands or send a message to chat.'),
        { parse_mode: 'HTML' },
      ).catch(() => {});
    });

    // Show list action from prompt
    bot.callbackQuery('remind_show_list', async (ctx) => {
      const list = getPendingReminders(ctx.from.id);
      await ctx.answerCallbackQuery();
      if (list.length === 0) {
        await ctx.editMessageText('No pending reminders.').catch(() => {});
        return;
      }
      const lines = list
        .map((r) => `• **${r.text}** — ${formatDueTime(r.due_at)}`)
        .join('\n');
      await ctx.editMessageText(
        markdownToTelegramHtml(`**Pending Reminders**\n\n${lines}`),
        { parse_mode: 'HTML' },
      ).catch(() => {});
    });

    logger.info('Reminder scheduler & actions registered');
  },
  commands: [
    {
      command: 'remind',
      description: 'Set a reminder: /remind <time> <text>',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const input = ctx.match?.trim();
        if (!input) {
          setPendingAction(userId, { type: 'awaiting_remind' });

          const keyboard = new InlineKeyboard()
            .text('❌ Cancel / Main Menu', 'remind_cancel_to_menu')
            .text('📋 Active Reminders', 'remind_show_list');

          await ctx.reply(
            markdownToTelegramHtml(
              '⏰ **Set a Reminder**\n\n' +
              'Tell me what to remind you about and when.\n\n' +
              '**Examples:**\n' +
              '• `7:30 pm Call John`\n' +
              '• `tomorrow at 10am Team standup`\n' +
              '• `20m Check oven`'
            ),
            {
              parse_mode: 'HTML',
              reply_markup: keyboard,
            },
          );
          return;
        }

        const parsed = parseReminderInput(input);
        if (!parsed) {
          await replySafe(
            ctx,
            'Could not understand the time or task.\n\n' +
            '**Examples:**\n' +
            '• `/remind 7:30 pm Call John`\n' +
            '• `/remind tomorrow at 10am Team standup`\n' +
            '• `/remind 20m Check server`',
          );
          return;
        }

        addReminder(userId, parsed.text, parsed.dueAt);
        await replySafe(ctx, `Reminder set for **${parsed.dueTimeStr}** (in ${parsed.relativeStr}): ${parsed.text}`);
      },
    },
    {
      command: 'reminders',
      description: 'List active reminders',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const list = getPendingReminders(userId);
        if (list.length === 0) {
          await replySafe(ctx, 'No pending reminders.');
          return;
        }

        const lines = list
          .map((r) => `• **${r.text}** — ${formatDueTime(r.due_at)}`)
          .join('\n');

        const keyboard = new InlineKeyboard();
        for (const r of list.slice(0, 5)) {
          const shortText = r.text.length > 20 ? r.text.slice(0, 18) + '…' : r.text;
          keyboard.text(`Cancel: ${shortText}`, `remind_cancel:${r.id}`).row();
        }

        await ctx.reply(
          markdownToTelegramHtml(`**Pending Reminders**\n\n${lines}`),
          {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          },
        );
      },
    },
  ],
  tools: [
    {
      name: 'create_reminder',
      description:
        'Schedule a future reminder for the user. Specify task text and either a target time string (e.g. "7:30 PM", "tomorrow 10:00 AM", "20m") or delay_seconds.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The reminder task description',
          },
          time: {
            type: 'string',
            description: 'Target time or relative duration (e.g. "7:30 PM", "19:30", "tomorrow at 10:00 AM", "20m", "2h")',
          },
          delay_seconds: {
            type: 'number',
            description: 'Optional delay in seconds from now (alternative to time)',
          },
        },
        required: ['text'],
      },
      async execute(args) {
        const text = String(args.text || 'Reminder').trim();
        let dueAt: number;

        if (args.time) {
          const parsedTimestamp = parseTargetTime(String(args.time));
          if (parsedTimestamp) {
            dueAt = parsedTimestamp;
          } else {
            const delay = Math.max(5, Number(args.delay_seconds || 60));
            dueAt = Date.now() + delay * 1000;
          }
        } else {
          const delay = Math.max(5, Number(args.delay_seconds || 60));
          dueAt = Date.now() + delay * 1000;
        }

        addReminder(config.telegram.ownerId, text, dueAt);

        const timeStr = formatDueTime(dueAt);
        const diffMs = dueAt - Date.now();
        const relativeStr = formatRelativeTime(diffMs);

        return JSON.stringify({
          success: true,
          text,
          time: timeStr,
          in: relativeStr,
        });
      },
    },
    {
      name: 'list_reminders',
      description: 'List all currently active pending reminders for the user',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const list = getPendingReminders(config.telegram.ownerId);
        return JSON.stringify(
          list.map((r) => ({
            text: r.text,
            time: formatDueTime(r.due_at),
          })),
        );
      },
    },
    {
      name: 'cancel_reminder',
      description: 'Cancel an active reminder by exact or partial task text',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Task name or description of the reminder to cancel',
          },
        },
        required: ['text'],
      },
      async execute(args) {
        const target = String(args.text || '').toLowerCase();
        const list = getPendingReminders(config.telegram.ownerId);
        const match = list.find((r) => r.text.toLowerCase().includes(target));

        if (!match) {
          return JSON.stringify({ success: false, message: 'No matching reminder found.' });
        }

        deleteReminder(config.telegram.ownerId, match.id);
        return JSON.stringify({ success: true, text: match.text });
      },
    },
  ],
};
