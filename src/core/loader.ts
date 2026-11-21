import type { Bot } from 'grammy';
import type { Plugin, BotCommand, ToolDefinition } from '../types/plugin.js';
import { logger } from '../utils/logger.js';

export function loadPlugins(bot: Bot, plugins: Plugin[]): void {
  for (const plugin of plugins) {
    if (plugin.init) {
      try {
        void plugin.init(bot);
        logger.debug('Initialized plugin lifecycle', { plugin: plugin.name });
      } catch (err: unknown) {
        logger.error('Failed to initialize plugin', { plugin: plugin.name, error: (err as Error).message });
      }
    }
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

// Collects all unique agentic tools registered across plugins.
export function getAllTools(plugins: Plugin[]): ToolDefinition[] {
  const toolMap = new Map<string, ToolDefinition>();

  for (const plugin of plugins) {
    for (const tool of plugin.tools ?? []) {
      if (toolMap.has(tool.name)) {
        logger.warn('Duplicate tool name detected across plugins, skipping duplicate', {
          plugin: plugin.name,
          tool: tool.name,
        });
        continue;
      }
      toolMap.set(tool.name, tool);
      logger.debug('Registered agentic tool', { plugin: plugin.name, tool: tool.name });
    }
  }

  return Array.from(toolMap.values());
}
