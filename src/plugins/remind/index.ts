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
} from '../../services/reminders.js';
import { replySafe, markdownToTelegramHtml } from '../../utils/format.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { Plugin } from '../../types/plugin.js';

let poller: NodeJS.Timeout | null = null;

function formatDueTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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
          await replySafe(ctx, 'Usage: `/remind <time> <text>` (e.g. `/remind 20m Check oven`)');
          return;
        }

        const match = input.match(/^(\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|days?))\s+(.+)$/i);
        if (!match) {
          await replySafe(ctx, 'Could not parse time. Example: `/remind 30m Check server`');
          return;
        }

        const durationStr = match[1];
        const reminderText = match[2].trim();
        const durationMs = parseDuration(durationStr);

        if (!durationMs || durationMs < 5000) {
          await replySafe(ctx, 'Reminder duration must be at least 5 seconds.');
          return;
        }

        const dueAt = Date.now() + durationMs;
        addReminder(userId, reminderText, dueAt);

        await replySafe(ctx, `Reminder set for ${formatDueTime(dueAt)} (in ${durationStr}).`);
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
      description: 'Schedule a future reminder for the user. Specify task text and delay in seconds from now.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The reminder task description',
          },
          delay_seconds: {
            type: 'number',
            description: 'Number of seconds from now when the reminder should trigger (e.g. 600 for 10m, 3600 for 1 hour)',
          },
        },
        required: ['text', 'delay_seconds'],
      },
      async execute(args) {
        const text = String(args.text || 'Reminder');
        const delaySeconds = Math.max(5, Number(args.delay_seconds || 60));
        const dueAt = Date.now() + delaySeconds * 1000;
        addReminder(config.telegram.ownerId, text, dueAt);

        const timeStr = formatDueTime(dueAt);
        const mins = Math.round(delaySeconds / 60);
        const relativeStr = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;

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
