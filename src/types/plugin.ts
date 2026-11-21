import type { Context, CommandContext, Filter } from 'grammy';

export type CommandHandler = (ctx: CommandContext<Context>) => Promise<void> | void;
export type MessageHandler = (ctx: Filter<Context, 'message:text'>) => Promise<void> | void;

export interface BotCommand {
  command: string;     // without the leading slash
  description: string; // shown in Telegram's command picker
  handler: CommandHandler;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<string> | string;
}

export interface Plugin {
  name: string;
  commands?: BotCommand[];
  onMessage?: MessageHandler;
  tools?: ToolDefinition[];
  init?: (bot: import('grammy').Bot) => void | Promise<void>;
}
