import { clearHistory } from '../../services/history.js';
import { clearPendingAction } from '../../services/userState.js';
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
        clearPendingAction(ctx.from.id);
        await replySafe(ctx, 'Session cleared. Saved memories preserved.');
      },
    },
    {
      command: 'cancel',
      description: 'Cancel any active prompt or action',
      async handler(ctx) {
        if (!ctx.from) return;
        const cleared = clearPendingAction(ctx.from.id);
        if (cleared) {
          await replySafe(ctx, 'Action cancelled.\n\nType /help to see all commands, or send a message to chat.');
        } else {
          await replySafe(ctx, 'Nothing to cancel.\n\nType /help to see all commands, or send a message to chat.');
        }
      },
    },
  ],
};
