// JSON lines in production so journald/Loki can parse them.
// Plain prefixed text in dev so it's readable in a terminal.
// Set LOG_LEVEL=debug|info|warn|error to control verbosity.

type Level = 'debug' | 'info' | 'warn' | 'error';
type Meta  = Record<string, unknown>;

const isProd = process.env.NODE_ENV === 'production';

const rank: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minRank =
  rank[(process.env.LOG_LEVEL?.toLowerCase() as Level) ?? ''] ??
  (isProd ? rank.info : rank.debug);

function write(level: Level, msg: string, meta: Meta = {}): void {
  if (rank[level] < minRank) return;

  if (isProd) {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }) + '\n');
  } else {
    const tag: Record<Level, string> = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' };
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    console[level === 'error' ? 'error' : 'log'](`[${tag[level]}] ${msg}${extra}`);
  }
}

export const logger = {
  debug: (msg: string, meta?: Meta) => write('debug', msg, meta),
  info:  (msg: string, meta?: Meta) => write('info',  msg, meta),
  warn:  (msg: string, meta?: Meta) => write('warn',  msg, meta),
  error: (msg: string, meta?: Meta) => write('error', msg, meta),
};
