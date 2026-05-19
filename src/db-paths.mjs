/**
 * Shared DB path resolution for fff-cli tools.
 *
 * Resolution order:
 *   1. FFF_FRECENCY_DB / FFF_HISTORY_DB env vars
 *   2. {basePath}/.fff/{frecency,history} (project-local)
 *   3. ~/.local/cache/fff/{frecency,history} (user home)
 */

import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function resolveDbPaths(basePath) {
  let frecencyDbPath = process.env.FFF_FRECENCY_DB ?? undefined;
  let historyDbPath = process.env.FFF_HISTORY_DB ?? undefined;

  if (!frecencyDbPath) {
    const autoBase = path.join(basePath, '.fff/frecency');
    try {
      if (fs.statSync(autoBase).isDirectory()) frecencyDbPath = autoBase;
    } catch {
      /* ignore */
    }
  }
  if (!frecencyDbPath) {
    const autoHome = path.join(homedir(), '.local/cache/fff/frecency');
    fs.mkdirSync(autoHome, { recursive: true });
    frecencyDbPath = autoHome;
  }
  if (!historyDbPath) {
    const autoBase = path.join(basePath, '.fff/history');
    try {
      if (fs.statSync(autoBase).isDirectory()) historyDbPath = autoBase;
    } catch {
      /* ignore */
    }
  }
  if (!historyDbPath) {
    const autoHome = path.join(homedir(), '.local/cache/fff/history');
    fs.mkdirSync(autoHome, { recursive: true });
    historyDbPath = autoHome;
  }
  return { frecencyDbPath, historyDbPath };
}
