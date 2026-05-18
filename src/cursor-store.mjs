/**
 * Shared per-query cursor store for fff-cli tools.
 *
 * Structure:
 * {
 *   "queries": {
 *     "pattern|constraints|limit": {
 *       "pattern": "...",
 *       "constraints": "...",
 *       "limit": 100,
 *       "pages": {
 *         "2": { "offset": 500, "ts": 123456 },
 *         "3": { "offset": 1200, "ts": 123457 }
 *       }
 *     }
 *   }
 * }
 *
 * Page numbers are 1-based in the user-facing API:
 *   - page "1" = first page (same as no --cursor)
 *   - page "2" = second page
 *   - etc.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_CURSOR_DIR = path.join(homedir(), '.local/cache/fff/cursors');
const CURSOR_DIR = process.env.FFF_CURSORS_DIR || DEFAULT_CURSOR_DIR;

export function createStore(filename) {
  const file = path.join(CURSOR_DIR, filename);

  function load() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return { queries: {} }; }
  }

  function save(data) {
    fs.mkdirSync(CURSOR_DIR, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  function prune(data) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const all = [];
    for (const [qk, q] of Object.entries(data.queries || {})) {
      for (const [pn, pg] of Object.entries(q.pages || {})) {
        if (pg.ts < cutoff) {
          delete q.pages[pn];
        } else {
          all.push({ qk, pn, ts: pg.ts });
        }
      }
      if (Object.keys(q.pages || {}).length === 0) {
        delete data.queries[qk];
      }
    }
    // Hard cap: 200 newest pages globally
    if (all.length > 200) {
      all.sort((a, b) => b.ts - a.ts);
      for (const { qk, pn } of all.slice(200)) {
        delete data.queries[qk].pages[pn];
        if (Object.keys(data.queries[qk].pages).length === 0) {
          delete data.queries[qk];
        }
      }
    }
  }

  function makeQueryKey(pattern, constraints, limit) {
    return `${pattern}|${constraints || ''}|${limit}`;
  }

  function store(queryKey, pattern, constraints, limit, pageNumber, payload) {
    const data = load() || { queries: {} };
    if (!data.queries) data.queries = {};
    let q = data.queries[queryKey];
    if (!q) {
      q = data.queries[queryKey] = { pattern, constraints, limit, pages: {} };
    }
    const pageStr = String(pageNumber);
    // Deduplicate: same payload already stored for this query
    for (const [pn, pg] of Object.entries(q.pages)) {
      if (payloadsEqual(pg, payload)) return pn;
    }
    q.pages[pageStr] = { ...payload, ts: Date.now() };
    prune(data);
    save(data);
    return pageStr;
  }

  function retrieve(queryKey, pageNumber) {
    const data = load();
    return data.queries?.[queryKey]?.pages?.[String(pageNumber)];
  }

  return { makeQueryKey, store, retrieve };
}

function payloadsEqual(a, b) {
  if (a.offset !== undefined && b.offset !== undefined) return a.offset === b.offset;
  if (a.pageIndex !== undefined && b.pageIndex !== undefined) return a.pageIndex === b.pageIndex;
  return false;
}
