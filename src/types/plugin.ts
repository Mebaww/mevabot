import type { Context, CommandContext, Filter } from 'grammy';

// ctx.match has everything typed after the command name e.g. "/proposal <this part>"
export type CommandHandler = (ctx: CommandContext<Context>) => Promise<void> | void;

// ctx.message.text is guaranteed non-null at this filter level
export type MessageHandler = (ctx: Filter<Context, 'message:text'>) => Promise<void> | void;

export interface BotCommand {
  command: string;     // without the leading slash
  description: string; // shown in Telegram's command picker
  handler: CommandHandler;
}

export interface Plugin {
  name: string;
  commands?: BotCommand[];
  onMessage?: MessageHandler;
}
