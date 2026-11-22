// Plugin registry with environment-based toggling.
// ORDER MATTERS: chatPlugin is guaranteed to be last — it's the catch-all handler.

import { clearPlugin }    from './clear/index.js';
import { statusPlugin }   from './status/index.js';
import { memoryPlugin }   from './memory/index.js';
import { remindPlugin }   from './remind/index.js';
import { proposalPlugin } from './proposal/index.js';
import { chatPlugin }     from './chat/index.js';
import type { Plugin }    from '../types/plugin.js';

// Available built-in plugins (chatPlugin is appended last)
const registry: Record<string, Plugin> = {
  clear: clearPlugin,
  status: statusPlugin,
  memory: memoryPlugin,
  remind: remindPlugin,
  proposal: proposalPlugin,
};

function resolvePlugins(): Plugin[] {
  const disabledEnv = process.env.DISABLED_PLUGINS?.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const enabledEnv = process.env.ENABLED_PLUGINS?.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

  const activePlugins = Object.entries(registry)
    .filter(([name]) => {
      // Whitelist mode (if ENABLED_PLUGINS is defined in .env)
      if (enabledEnv && enabledEnv.length > 0) {
        return enabledEnv.includes(name);
      }
      // Blacklist mode (default: all active unless in DISABLED_PLUGINS)
      return !disabledEnv.includes(name);
    })
    .map(([, plugin]) => plugin);

  // chatPlugin is the conversational AI fallback — must always be registered and always last
  return [...activePlugins, chatPlugin];
}

export const plugins: Plugin[] = resolvePlugins();
