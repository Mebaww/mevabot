// Memory management plugin: /memories, /remember, /forget
import {
  getAllMemories,
  addMemory,
  deleteMemory,
  clearAllMemories,
} from '../../services/memory.js';
import { replySafe } from '../../utils/format.js';
import type { Plugin } from '../../types/plugin.js';

export const memoryPlugin: Plugin = {
  name: 'memory',
  commands: [
    {
      command: 'memories',
      description: 'View learned facts',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const list = getAllMemories(userId);

        if (list.length === 0) {
          await replySafe(ctx, 'No saved memories.');
          return;
        }

        const lines = list.map((m) => `• #${m.id}: ${m.fact}`).join('\n');
        await replySafe(ctx, `**Saved Memories**\n\n${lines}`);
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
      description: 'Delete memory (/forget <id> or /forget all)',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const arg = ctx.match?.trim().toLowerCase();

        if (!arg) {
          await replySafe(ctx, 'Usage: `/forget <id>` or `/forget all`');
          return;
        }

        if (arg === 'all') {
          clearAllMemories(userId);
          await replySafe(ctx, 'All memories deleted.');
          return;
        }

        const id = parseInt(arg, 10);
        if (isNaN(id) || id <= 0) {
          await replySafe(ctx, 'Please provide a valid memory ID (e.g. `/forget 3`).');
          return;
        }

        const deleted = deleteMemory(userId, id);
        if (deleted) {
          await replySafe(ctx, `Deleted memory #${id}.`);
        } else {
          await replySafe(ctx, `Memory #${id} not found.`);
        }
      },
    },
  ],
};
