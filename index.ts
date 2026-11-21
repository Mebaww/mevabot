import 'dotenv/config';

import { Bot } from 'grammy';
import { config }                    from './src/config.js';
import { logger }                    from './src/utils/logger.js';
import { authMiddleware }            from './src/middleware/auth.js';
import { loadPlugins, getCommands }  from './src/core/loader.js';
import { plugins }                   from './src/plugins/index.js';

const bot = new Bot(config.telegram.token);

bot.use(authMiddleware);
loadPlugins(bot, plugins);

// /start and /help auto-build from whatever plugins are registered
bot.command(['start', 'help'], async (ctx) => {
  const lines = getCommands(plugins)
    .map(({ command, description }) => `\`/${command}\` — ${description}`)
    .join('\n');

  await ctx.reply(`*mevaplus*\n\n${lines}\n\nOr just send any message to chat.`, {
    parse_mode: 'Markdown',
  });
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
  await bot.stop();
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
