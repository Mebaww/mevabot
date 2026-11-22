import 'dotenv/config';

import { Bot } from 'grammy';
import { config }                    from './src/config.js';
import { logger }                    from './src/utils/logger.js';
import { authMiddleware }            from './src/middleware/auth.js';
import { loadPlugins, getCommands }  from './src/core/loader.js';
import { plugins }                   from './src/plugins/index.js';
import { db }                        from './src/services/db.js';
import { replySafe }                 from './src/utils/format.js';

const bot = new Bot(config.telegram.token);

bot.use(authMiddleware);
loadPlugins(bot, plugins);

// /start and /help auto-build from whatever plugins are registered
bot.command(['start', 'help'], async (ctx) => {
  const lines = getCommands(plugins)
    .map(({ command, description }) => `/${command} — ${description}`)
    .join('\n');

  await replySafe(ctx, `**Commands**\n\n${lines}\n\nSend any message to chat.`);
});

bot.start({
  onStart: async (info) => {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Show available commands' },
      ...getCommands(plugins),
    ]);
    logger.info(`Bot started: @${info.username}`);
  },
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);
  try {
    await bot.stop();
  } catch (err: unknown) {
    logger.warn('Error stopping bot', { error: (err as Error).message });
  }

  try {
    db.close();
    logger.info('Database connection closed cleanly');
  } catch (err: unknown) {
    logger.warn('Error closing database', { error: (err as Error).message });
  }

  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
