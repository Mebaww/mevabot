// Plugin registry — this is the only file you touch to add or remove plugins.
// ORDER MATTERS: chatPlugin must always be last — it's the catch-all handler.

import { clearPlugin }    from './clear/index.js';
import { statusPlugin }   from './status/index.js';
import { memoryPlugin }   from './memory/index.js';
import { remindPlugin }   from './remind/index.js';
import { proposalPlugin } from './proposal/index.js';
import { chatPlugin }     from './chat/index.js';
import type { Plugin }    from '../types/plugin.js';

export const plugins: Plugin[] = [
  clearPlugin,
  statusPlugin,
  memoryPlugin,
  remindPlugin,
  proposalPlugin,
  // your custom plugins go here ↑
  chatPlugin, // keep last
];
