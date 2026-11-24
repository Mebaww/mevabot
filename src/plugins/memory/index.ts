// Memory management plugin: /memories, /remember, /forget
import { InlineKeyboard, type Context } from 'grammy';
import {
  getAllMemories,
  addMemory,
  deleteMemory,
  clearAllMemories,
} from '../../services/memory.js';
import { replySafe, markdownToTelegramHtml } from '../../utils/format.js';
import type { Plugin } from '../../types/plugin.js';

interface MemoryRow {
  id: number;
  fact: string;
}

type GroupKey = 'identity' | 'projects' | 'stack' | 'preferences' | 'other';
type CategoryKey = GroupKey | 'all';

const PAGE_SIZE = 5;

const GROUP_ORDER: GroupKey[] = ['identity', 'projects', 'stack', 'preferences', 'other'];

const CATEGORIES: Array<{ key: GroupKey; label: string; emoji: string; pattern: RegExp }> = [
  {
    key: 'identity',
    label: 'Identity & Work',
    emoji: '👤',
    pattern:
      /\b(name|call me|i am|i'm|developers?|engineers?|freelanc\w*|my role|my job|work(?:ing)? as|live[sd]?|based|located|location|timezone|country|city|student|founder)\b/i,
  },
  {
    key: 'projects',
    label: 'Projects & Builds',
    emoji: '📦',
    pattern:
      /\b(project\w*|building|build\w*|built|app|website|saas|startup|product|client|portfolio|bot|meva)\b/i,
  },
  {
    key: 'stack',
    label: 'Stack & Tools',
    emoji: '🛠️',
    pattern:
      /\b(stack|tech|react|next\.?js|typescript|javascript|node|express|python|django|flask|sql|postgres\w*|mysql|mongo\w*|prisma|supabase|tailwind|sanity|payload|figma|docker|aws|vercel|git|graphql|redis|php|laravel|java|golang|rust|swift|kotlin|flutter|wordpress|shopify|framer)\b/i,
  },
  {
    key: 'preferences',
    label: 'Preferences',
    emoji: '⭐',
    pattern:
      /\b(prefer\w*|like[sd]?|lov\w*|favorite|favourite|enjoy\w*|hate[sd]?|dislike[sd]?|avoid\w*|tone|style|communicat\w*|reply|format|never|always)\b/i,
  },
];

function classifyMemory(fact: string): GroupKey {
  for (const category of CATEGORIES) {
    if (category.pattern.test(fact)) return category.key;
  }
  return 'other';
}

function categoryMeta(key: CategoryKey): { label: string; emoji: string } {
  if (key === 'all') return { label: 'All memories', emoji: '📋' };
  if (key === 'other') return { label: 'Other', emoji: '🗂️' };
  const found = CATEGORIES.find((category) => category.key === key);
  return found ? { label: found.label, emoji: found.emoji } : { label: 'Other', emoji: '🗂️' };
}

function isCategoryKey(value: string): value is CategoryKey {
  return value === 'all' || GROUP_ORDER.includes(value as GroupKey);
}

function groupMemories(list: MemoryRow[]): Record<GroupKey, MemoryRow[]> {
  const groups: Record<GroupKey, MemoryRow[]> = {
    identity: [],
    projects: [],
    stack: [],
    preferences: [],
    other: [],
  };

  for (const row of list) {
    groups[classifyMemory(row.fact)].push(row);
  }

  return groups;
}

function buildSummary(list: MemoryRow[]): { text: string; keyboard: InlineKeyboard } {
  const groups = groupMemories(list);
  const activeGroups = GROUP_ORDER.filter((key) => groups[key].length > 0);

  const lines = [
    '🧠 **Memory Profile**',
    `${list.length} fact${list.length === 1 ? '' : 's'} stored`,
    '',
  ];

  for (const key of activeGroups) {
    const meta = categoryMeta(key);
    lines.push(`${meta.emoji} ${meta.label} — ${groups[key].length}`);
  }

  lines.push('', 'Tap a category to browse, then 🗑 to forget a fact.');

  const keyboard = new InlineKeyboard();
  for (let i = 0; i < activeGroups.length; i += 2) {
    for (const key of activeGroups.slice(i, i + 2)) {
      const meta = categoryMeta(key);
      keyboard.text(`${meta.emoji} ${meta.label} (${groups[key].length})`, `mem_cat:${key}:1`);
    }
    keyboard.row();
  }

  keyboard.text(`📋 All (${list.length})`, 'mem_cat:all:1').row();
  keyboard.text('🧹 Clear all', 'mem_clear');

  return { text: lines.join('\n'), keyboard };
}

function buildCategoryPage(
  list: MemoryRow[],
  category: CategoryKey,
  requestedPage: number,
  mode: 'browse' | 'forget' = 'browse',
): { text: string; keyboard: InlineKeyboard } {
  const filtered =
    category === 'all' ? list : list.filter((row) => classifyMemory(row.fact) === category);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);
  const meta = categoryMeta(category);

  const heading =
    mode === 'forget' ? '🗑 **Forget a Memory**' : `${meta.emoji} **${meta.label}**`;
  const lines = [
    heading,
    `${filtered.length} fact${filtered.length === 1 ? '' : 's'} · page ${page}/${totalPages}`,
  ];

  if (mode === 'forget') {
    lines.push('Tap 🗑 next to the fact you want me to forget.');
  }

  lines.push('');

  for (const row of rows) {
    const fact = row.fact.length > 150 ? `${row.fact.slice(0, 147)}…` : row.fact;
    lines.push(`**#${row.id}** — ${fact}`);
  }

  const keyboard = new InlineKeyboard();

  // Per-memory delete buttons, three per row.
  for (let i = 0; i < rows.length; i++) {
    keyboard.text(`🗑 #${rows[i].id}`, `mem_del:${rows[i].id}`);
    if ((i + 1) % 3 === 0 || i === rows.length - 1) keyboard.row();
  }

  if (page > 1) {
    keyboard.text(
      '◀️ Prev',
      mode === 'forget' ? `mem_forget:${page - 1}` : `mem_cat:${category}:${page - 1}`,
    );
  }
  keyboard.text(`${page}/${totalPages}`, 'mem_noop');
  if (page < totalPages) {
    keyboard.text(
      'Next ▶️',
      mode === 'forget' ? `mem_forget:${page + 1}` : `mem_cat:${category}:${page + 1}`,
    );
  }
  keyboard.row();
  keyboard.text('⬅️ Categories', 'mem_home');

  return { text: lines.join('\n'), keyboard };
}

function buildDeleteConfirm(row: MemoryRow): { text: string; keyboard: InlineKeyboard } {
  return {
    text: [
      `🗑 **Delete memory #${row.id}?**`,
      '',
      `"${row.fact}"`,
      '',
      'This only removes it from what I remember.',
    ].join('\n'),
    keyboard: new InlineKeyboard()
      .text('✅ Delete', `mem_del_yes:${row.id}`)
      .text('❌ Cancel', 'mem_home'),
  };
}

function buildClearConfirm(count: number): { text: string; keyboard: InlineKeyboard } {
  return {
    text: [
      '🧹 **Clear all memories?**',
      '',
      `Delete all ${count} saved fact${count === 1 ? '' : 's'}? This cannot be undone.`,
    ].join('\n'),
    keyboard: new InlineKeyboard().text('✅ Delete all', 'mem_clear_yes').text('❌ Cancel', 'mem_home'),
  };
}

async function render(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard,
  mode: 'reply' | 'edit' = 'reply',
): Promise<void> {
  const html = markdownToTelegramHtml(text);
  const extra = {
    parse_mode: 'HTML' as const,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  };

  if (mode === 'edit') {
    try {
      await ctx.editMessageText(html, extra);
      return;
    } catch {
      // Message may be too old to edit; fall through and send a fresh one.
    }
  }

  try {
    await ctx.reply(html, extra);
  } catch {
    await ctx.reply(text, keyboard ? { reply_markup: keyboard } : {}).catch(() => {});
  }
}

export const memoryPlugin: Plugin = {
  name: 'memory',
  init(bot) {
    // Back to the category summary
    bot.callbackQuery('mem_home', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;
      const list = getAllMemories(userId);
      await ctx.answerCallbackQuery();

      if (list.length === 0) {
        await render(ctx, 'No saved memories.', undefined, 'edit');
        return;
      }

      const { text, keyboard } = buildSummary(list);
      await render(ctx, text, keyboard, 'edit');
    });

    // Browse a category or all memories
    bot.callbackQuery(/^mem_cat:([a-z]+):(\d+)$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const category = ctx.match[1];
      if (!isCategoryKey(category)) {
        await ctx.answerCallbackQuery({ text: 'Unknown category' });
        return;
      }

      const list = getAllMemories(userId);
      await ctx.answerCallbackQuery();

      if (list.length === 0) {
        await render(ctx, 'No saved memories.', undefined, 'edit');
        return;
      }

      const { text, keyboard } = buildCategoryPage(list, category, parseInt(ctx.match[2], 10));
      await render(ctx, text, keyboard, 'edit');
    });

    // Paginate the forget list (keeps the delete-focused view)
    bot.callbackQuery(/^mem_forget:(\d+)$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const list = getAllMemories(userId);
      await ctx.answerCallbackQuery();

      if (list.length === 0) {
        await render(ctx, 'No saved memories.', undefined, 'edit');
        return;
      }

      const { text, keyboard } = buildCategoryPage(list, 'all', parseInt(ctx.match[1], 10), 'forget');
      await render(ctx, text, keyboard, 'edit');
    });

    // Ask before deleting one memory
    bot.callbackQuery(/^mem_del:(\d+)$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const id = parseInt(ctx.match[1], 10);
      const row = getAllMemories(userId).find((memory) => memory.id === id);
      await ctx.answerCallbackQuery();

      if (!row) {
        await render(
          ctx,
          `Memory #${id} not found.`,
          new InlineKeyboard().text('⬅️ Back to memories', 'mem_home'),
          'edit',
        );
        return;
      }

      const { text, keyboard } = buildDeleteConfirm(row);
      await render(ctx, text, keyboard, 'edit');
    });

    // Confirmed single delete
    bot.callbackQuery(/^mem_del_yes:(\d+)$/, async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const id = parseInt(ctx.match[1], 10);
      const deleted = deleteMemory(userId, id);
      await ctx.answerCallbackQuery({ text: deleted ? `Deleted #${id}` : 'Already gone' });

      await render(
        ctx,
        deleted ? `Deleted memory #${id}.` : `Memory #${id} not found.`,
        new InlineKeyboard().text('⬅️ Back to memories', 'mem_home'),
        'edit',
      );
    });

    // Ask before wiping everything
    bot.callbackQuery('mem_clear', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const list = getAllMemories(userId);
      await ctx.answerCallbackQuery();

      if (list.length === 0) {
        await render(ctx, 'No saved memories.', undefined, 'edit');
        return;
      }

      const { text, keyboard } = buildClearConfirm(list.length);
      await render(ctx, text, keyboard, 'edit');
    });

    // Confirmed clear-all
    bot.callbackQuery('mem_clear_yes', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      clearAllMemories(userId);
      await ctx.answerCallbackQuery({ text: 'All memories cleared' });
      await render(
        ctx,
        'All memories deleted.',
        new InlineKeyboard().text('⬅️ Back to memories', 'mem_home'),
        'edit',
      );
    });

    // Page indicator button (no-op)
    bot.callbackQuery('mem_noop', async (ctx) => {
      await ctx.answerCallbackQuery();
    });
  },
  commands: [
    {
      command: 'memories',
      description: 'Browse saved facts',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const list = getAllMemories(userId);

        if (list.length === 0) {
          await replySafe(
            ctx,
            'No saved memories yet.\n\nUse `/remember <fact>` or just chat normally and I\'ll learn about you.',
          );
          return;
        }

        const { text, keyboard } = buildSummary(list);
        await render(ctx, text, keyboard);
      },
    },
    {
      command: 'remember',
      description: 'Save a profile fact',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const fact = ctx.match?.trim();
        if (!fact) {
          await replySafe(ctx, 'Usage: `/remember <fact>` (e.g. `/remember I prefer TypeScript`)');
          return;
        }

        const added = addMemory(userId, fact);
        if (added) {
          await replySafe(ctx, `Remembered: "${fact}"`);
        } else {
          await replySafe(ctx, 'Fact already recorded.');
        }
      },
    },
    {
      command: 'forget',
      description: 'Choose memories to delete',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const list = getAllMemories(userId);
        if (list.length === 0) {
          await replySafe(ctx, 'No saved memories to forget.');
          return;
        }

        if (ctx.match?.trim().toLowerCase() === 'all') {
          const { text, keyboard } = buildClearConfirm(list.length);
          await render(ctx, text, keyboard);
          return;
        }

        // No IDs to remember: browse the facts and tap the 🗑 button.
        const { text, keyboard } = buildCategoryPage(list, 'all', 1, 'forget');
        await render(ctx, text, keyboard);
      },
    },
  ],
};
