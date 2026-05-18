#!/usr/bin/env node
/**
 * Standalone CLI wrapper around @ff-labs/fff-node for OR-logic multi-pattern grep.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const { resolveFffNode } = await import(path.join(SRC_DIR, 'resolve-fff.mjs'));
const { createStore } = await import(path.join(SRC_DIR, 'cursor-store.mjs'));
const { resolveDbPaths } = await import(path.join(SRC_DIR, 'db-paths.mjs'));
const {
  ipcAvailable, dslMultiGrep, setSockPath, getSockPath,
} = await import(path.join(SRC_DIR, 'ipc-client.mjs'));
const { formatGrepOutput } = await import(path.join(SRC_DIR, 'grep-format.mjs'));
const { normalizeConstraints } = await import(path.join(SRC_DIR, 'normalize-constraints.mjs'));

const { FileFinder } = await resolveFffNode();
const NAME = path.basename(process.argv[1] || 'fff-multi-grep.mjs');
const cursors = createStore('fff-multi-grep-cursors.json');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function showHelp(exitCode = 0) {
  const sink = exitCode === 0 ? console.log : console.error;
  sink(`Usage: ${NAME} <p1,p2,...> [options]`);
  sink('Options:');
  sink('  -c, --constraints <...>   Path filter constraints');
  sink('  -i, --ignore-case         Case-insensitive (default: smartCase)');
  sink('      --context <N>         Lines before and after each match');
  sink('  -b, --before-context <N>  Lines before each match');
  sink('  -a, --after-context <N>   Lines after each match');
  sink('  -l, --limit <N>           Max matches per file (default: 50, max 100)');
  sink('  -p, --page-size <N>       Number of matched files per page (default: 50)');
  sink('  -n, --cursor <id>         Page number (default: 1)');
  sink('  -s, --sock <path>         Daemon socket (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)');
  sink('');
  sink('Standalone Options (Non-Daemon mode):');
  sink('      --base <path>         Base directory (forces standalone mode)');
  sink('      --frecency-db <path>  Frecency DB');
  sink('      --history-db <path>   History DB');
  sink('');
  sink('      --help                Show this message');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {
    patterns: undefined, basePath: process.cwd(), constraints: undefined,
    ignoreCase: false, beforeContext: 0, afterContext: 0, limit: 50, pageSize: 0, cursor: undefined,
    frecencyDbPath: undefined, historyDbPath: undefined, sockPath: undefined,
    basePathExplicit: false,
  };
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': showHelp(); break;
      case '-c': case '--constraints': result.constraints = argv[++i]; break;
      case '-i': case '--ignore-case': result.ignoreCase = true; break;
      case '--context': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --context requires a number`); process.exit(1); }
        result.beforeContext = n; result.afterContext = n; break;
      }
      case '-b': case '--before-context': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --before-context requires a number`); process.exit(1); }
        result.beforeContext = n; break;
      }
      case '-a': case '--after-context': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --after-context requires a number`); process.exit(1); }
        result.afterContext = n; break;
      }
      case '-l': case '--limit': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --limit requires a number`); process.exit(1); }
        result.limit = n; break;
      }
      case '-p': case '--page-size': {
        const n = parseInt(argv[++i], 10);
        if (Number.isNaN(n)) { console.error(`${NAME}: --page-size requires a number`); process.exit(1); }
        result.pageSize = n; break;
      }
      case '-n': case '--cursor': result.cursor = argv[++i]; break;
      case '--base': result.basePath = argv[++i]; result.basePathExplicit = true; break;
      case '--frecency-db': result.frecencyDbPath = argv[++i]; break;
      case '--history-db': result.historyDbPath = argv[++i]; break;
      case '-s': case '--sock': result.sockPath = argv[++i]; break;
      default:
        if (arg.startsWith('-')) { console.error(`${NAME}: unknown option: ${arg}`); process.exit(1); }
        remaining.push(arg);
    }
  }
  if (remaining.length > 0) result.patterns = remaining[0];
  return result;
}

// ---------------------------------------------------------------------------
// Local fallback
// ---------------------------------------------------------------------------

async function runLocal(args, patterns, pageNum, cursor, normalizedConstraints) {
  console.log(`→ Creating FileFinder for: ${args.basePath}`);
  const { frecencyDbPath, historyDbPath } = resolveDbPaths(args.basePath);
  const finderResult = FileFinder.create({
    basePath: args.basePath, aiMode: true,
    frecencyDbPath: args.frecencyDbPath ?? frecencyDbPath,
    historyDbPath: args.historyDbPath ?? historyDbPath,
  });
  if (!finderResult.ok) { console.error('Failed:', finderResult.error); process.exit(1); }
  const finder = finderResult.value;

  console.log('→ Waiting for scan...');
  const scanDone = await finder.waitForScan(30000);
  if (!scanDone.ok || !scanDone.value) console.warn('Scan timeout, proceeding...');
  const progress = finder.getScanProgress();
  if (progress.ok) console.log(`  Indexed ${progress.value.scannedFilesCount} files${progress.value.isScanning ? ' (scanning...)' : ''}`);
  const dbInfo = [];
  if (args.frecencyDbPath ?? frecencyDbPath) dbInfo.push('frecency');
  if (args.historyDbPath ?? historyDbPath) dbInfo.push('history');
  if (dbInfo.length > 0) console.log(`  Using DBs: ${dbInfo.join(', ')}`);

  console.log(`→ Multi-grepping ${patterns.length} patterns: ${patterns.map(p => `"${p}"`).join(', ')}`);

  const grepResult = finder.multiGrep({
    patterns, constraints: normalizedConstraints,
    maxMatchesPerFile: Math.min(Math.max(1, args.limit), 100),
    pageSize: args.pageSize || 0,
    smartCase: !args.ignoreCase, cursor,
    beforeContext: args.beforeContext, afterContext: args.afterContext,
    classifyDefinitions: true,
  });
  if (!grepResult.ok) { console.error('Multi-grep failed:', grepResult.error); process.exit(1); }
  return grepResult.value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
if (args.sockPath) setSockPath(args.sockPath);
if (!args.patterns) showHelp(1);

const patterns = args.patterns.split(',').map(p => p.trim()).filter(Boolean);
if (patterns.length === 0) { console.error('Error: --patterns must contain at least one pattern'); process.exit(1); }

const normalizedConstraints = normalizeConstraints(args.constraints);
const patternStr = patterns.join(',');
const pageNum = parseInt(args.cursor || '1', 10);

let result, viaDaemon = false;

if (!args.basePathExplicit) {
  const daemonOk = await ipcAvailable();
  if (daemonOk) {
    try {
      console.log(`→ [via daemon ${getSockPath()}] Multi-grepping ${patterns.length} patterns: ${patterns.map(p => `"${p}"`).join(', ')}`);
      viaDaemon = true;
      const queryKey = cursors.makeQueryKey(patternStr, normalizedConstraints, args.limit, args.pageSize);
      const stored = cursors.retrieve(queryKey, pageNum);
      let cursorRaw = null;
      if (pageNum !== 1) {
        if (!stored) {
          console.error(`Cursor ${pageNum} not found for this query. Run without --cursor first.`);
          process.exit(1);
        }
        cursorRaw = { _offset: stored.offset };
      }
      result = await dslMultiGrep(patterns, {
        constraints: normalizedConstraints,
        limit: args.limit,
        pageSize: args.pageSize,
        smartCase: !args.ignoreCase,
        cursorRaw,
        beforeContext: args.beforeContext,
        afterContext: args.afterContext,
      });
    } catch (e) {
      console.warn('Daemon request failed, falling back to local:', e.message);
      result = null;
      viaDaemon = false;
    }
  }
}

if (!result) {
  const queryKey = cursors.makeQueryKey(patternStr, normalizedConstraints, args.limit, args.pageSize);
  const stored = cursors.retrieve(queryKey, pageNum);
  let cursor = null;
  if (pageNum !== 1) {
    if (!stored) {
      console.error(`Cursor ${pageNum} not found for this query. Run without --cursor first.`);
      process.exit(1);
    }
    cursor = { __brand: 'GrepCursor', _offset: stored.offset };
  }
  result = await runLocal(args, patterns, pageNum, cursor, normalizedConstraints);
}

let output = formatGrepOutput(result, args.basePath);
const notices = [];
if ((result.items?.length ?? 0) >= args.limit) notices.push(`${args.limit}+ matches (refine patterns)`);
const nextOffset = result.nextCursor?._offset ?? null;
if (nextOffset !== null) {
  const nextPage = pageNum + 1;
  cursors.store(cursors.makeQueryKey(patternStr, normalizedConstraints, args.limit, args.pageSize), patternStr, normalizedConstraints, args.limit, nextPage, { offset: nextOffset });
  notices.push(`Continue with cursor="${nextPage}"`);
}
if (viaDaemon) notices.push('via daemon');
if (notices.length > 0) output += `\n\n[${notices.join('. ')}]`;

console.log('\n' + output + '\n');
console.log(`Matched ${result.totalMatched ?? 0} lines across ${result.totalFilesSearched ?? '?'} files searched (${result.filteredFileCount ?? '?'} eligible)`);
