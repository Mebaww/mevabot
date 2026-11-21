// Silently drop any message that doesn't come from the owner.
// No reply — don't reveal the bot exists to strangers.

import type { Context, NextFunction } from 'grammy';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.from?.id !== config.telegram.ownerId) {
    logger.warn('Blocked unauthorized user', { id: ctx.from?.id });
    return;
  }
  await next();
}
