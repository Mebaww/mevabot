import { clearHistory } from '../../services/history.js';
import type { Plugin }      from '../../types/plugin.js';

export const clearPlugin: Plugin = {
  name: 'clear',
  commands: [
    {
      command: 'clear',
      description: 'Clear current conversation session',
      async handler(ctx) {
        if (!ctx.from) return;
        clearHistory(ctx.from.id);
        await ctx.reply(
          '🧹 Current session cleared.\n\n_Your long-term memories are preserved. Use /memories to view them._',
          { parse_mode: 'Markdown' },
        );
      },
    },
  ],
};
