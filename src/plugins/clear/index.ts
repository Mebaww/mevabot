import { clearHistory } from '../../services/history.js';
import { replySafe }    from '../../utils/format.js';
import type { Plugin }  from '../../types/plugin.js';

export const clearPlugin: Plugin = {
  name: 'clear',
  commands: [
    {
      command: 'clear',
      description: 'Clear conversation session',
      async handler(ctx) {
        if (!ctx.from) return;
        clearHistory(ctx.from.id);
        await replySafe(ctx, 'Session cleared. Saved memories preserved.');
      },
    },
  ],
};
