import { clearHistory } from '../../services/history.js';
import type { Plugin } from '../../types/plugin.js';

export const clearPlugin: Plugin = {
  name: 'clear',
  commands: [
    {
      command: 'clear',
      description: 'Clear conversation memory',
      async handler(ctx) {
        if (!ctx.from) return;
        clearHistory(ctx.from.id);
        await ctx.reply('Memory cleared.');
      },
    },
  ],
};
