import type { Bot } from 'grammy';
import type { Plugin, BotCommand } from '../types/plugin.js';
import { logger } from '../utils/logger.js';

export function loadPlugins(bot: Bot, plugins: Plugin[]): void {
  for (const plugin of plugins) {
    for (const cmd of plugin.commands ?? []) {
      bot.command(cmd.command, cmd.handler);
      logger.debug('Registered command', { plugin: plugin.name, command: cmd.command });
    }
    if (plugin.onMessage) {
      bot.on('message:text', plugin.onMessage);
      logger.debug('Registered message handler', { plugin: plugin.name });
    }
  }
  logger.info(`Loaded ${plugins.length} plugin(s)`);
}

// Collects { command, description } from every plugin for setMyCommands.
export function getCommands(plugins: Plugin[]): Pick<BotCommand, 'command' | 'description'>[] {
  return plugins.flatMap((p) =>
    (p.commands ?? []).map(({ command, description }) => ({ command, description })),
  );
}
