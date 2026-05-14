#!/usr/bin/env node
/**
 * fff-scan — pre-scan a directory and optionally warm the frecency/history DBs.
 *
 * Usage:
 *   fff-scan <directory> [options]
 *
 *   fff-scan ~/my-project
 *   fff-scan ~/my-project --pattern "TODO" --grep
 *   fff-scan ~/my-project --pattern "*.ts" --find
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SRC_DIR = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const { resolveFffNode } = await import(path.join(SRC_DIR, 'resolve-fff.mjs'));

const { FileFinder } = await resolveFffNode();
const NAME = path.basename(process.argv[1] || 'fff-scan.mjs');

// ---------------------------------------------------------------------------
// DB path resolution
// ---------------------------------------------------------------------------

function resolveDbPaths(basePath) {
  let frecencyDbPath = process.env.FFF_FRECENCY_DB ?? undefined;
  let historyDbPath = process.env.FFF_HISTORY_DB ?? undefined;

  if (!frecencyDbPath) {
    const autoBase = path.join(basePath, '.local/share/fff/frecency');
    try { if (fs.statSync(autoBase).isDirectory()) frecencyDbPath = autoBase; } catch {}
  }
  if (!frecencyDbPath) {
    const autoHome = path.join(homedir(), '.local/share/fff/frecency');
    try { if (fs.statSync(autoHome).isDirectory()) frecencyDbPath = autoHome; } catch {}
  }
  if (!historyDbPath) {
    const autoBase = path.join(basePath, '.local/share/fff/history');
    try { if (fs.statSync(autoBase).isDirectory()) historyDbPath = autoBase; } catch {}
  }
  if (!historyDbPath) {
    const autoHome = path.join(homedir(), '.local/share/fff/history');
    try { if (fs.statSync(autoHome).isDirectory()) historyDbPath = autoHome; } catch {}
  }
  return { frecencyDbPath, historyDbPath };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function showHelp(exitCode = 0) {
  const sink = exitCode === 0 ? console.log : console.error;
  sink(`Usage: ${NAME} <directory> [options]`);
  sink();
  sink('Options:');
  sink('  --pattern    <str>   Pattern to warm frecency/history DBs after scan');
  sink('  --find               Treat --pattern as a file-search pattern');
  sink('  --grep               Treat --pattern as a content-search pattern (default)');
  sink('  --constraints <...>  Include/exclude filters');
  sink('  --literal            Force literal match (--grep only)');
  sink('  --regex              Force regex match (--grep only)');
  sink('  --ignore-case        Case-insensitive (--grep only)');
  sink('  --context <N>        Context lines (--grep only)');
  sink('  --limit <N>          Max results to warm (default: 100)');
  sink('  --frecency-db <path> Path to frecency DB');
  sink('  --history-db <path>  Path to history DB');
  sink('  --help               Show this message');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {
    directory: undefined,
    pattern: undefined,
    mode: undefined,       // 'find' | 'grep' | undefined
    constraints: undefined,
    ignoreCase: false,
    literal: undefined,
    context: 0,
    limit: 100,
    frecencyDbPath: undefined,
    historyDbPath: undefined,
  };
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':        showHelp(); break;
      case '--pattern':     result.pattern = argv[++i]; break;
      case '--find':        result.mode = 'find'; break;
      case '--grep':        result.mode = 'grep'; break;
      case '--constraints': result.constraints = argv[++i]; break;
      case '--ignore-case': result.ignoreCase = true; break;
      case '--literal':     result.literal = true; break;
      case '--regex':       result.literal = false; break;
      case '--context':     result.context = parseInt(argv[++i], 10); break;
      case '--limit':       result.limit = parseInt(argv[++i], 10); break;
      case '--frecency-db': result.frecencyDbPath = argv[++i]; break;
      case '--history-db':  result.historyDbPath = argv[++i]; break;
      default:
        if (arg.startsWith('-')) { console.error(`${NAME}: unknown option: ${arg}`); process.exit(1); }
        remaining.push(arg);
    }
  }
  if (remaining.length > 0) result.directory = remaining[0];
  return result;
}

// ---------------------------------------------------------------------------
// Query building (same as ffgrep)
// ---------------------------------------------------------------------------

function normalizePathConstraint(s) {
  let t = s.trim();
  if (!t || t === '.' || t === './') return null;
  if (t.startsWith('./')) t = t.slice(2);
  const m = t.match(/^(.*)\/\*\*(?:\/\*)?$/);
  if (m && m[1] && !/[*?[{]/.test(m[1])) return `${m[1]}/`;
  if (t.startsWith('/') || t.endsWith('/')) return t;
  if (/[*?[{]/.test(t)) return t;
  const last = t.split('/').pop() ?? '';
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(last)) return t;
  return `${t}/`;
}

function buildQuery(constraints, pattern) {
  const parts = [];
  if (constraints) {
    for (const term of constraints.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)) {
      const neg = term.startsWith('!');
      const raw = neg ? term.slice(1) : term;
      const n = normalizePathConstraint(raw);
      if (n) parts.push(neg ? `!${n}` : n);
    }
  }
  parts.push(pattern);
  return parts.join(' ');
}

function resolveGrepMode(pattern, literal) {
  if (literal === true) return 'plain';
  if (literal === false) return 'regex';
  const hasMeta = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (hasMeta) { try { new RegExp(pattern); return 'regex'; } catch { return 'plain'; } }
  return 'plain';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

if (!args.directory) showHelp(1);

if (args.pattern && !args.mode) args.mode = 'grep';  // default to grep for DB warming
if (args.pattern && args.mode === 'grep' && args.limit > 100) args.limit = 100;   // cap grep warming

const isDir = fs.statSync(args.directory).isDirectory();

console.log(`→ Creating FileFinder for: ${args.directory}`);
const { frecencyDbPath, historyDbPath } = resolveDbPaths(args.directory);
const finderResult = FileFinder.create({
  basePath: args.directory,
  aiMode: true,
  frecencyDbPath: args.frecencyDbPath ?? frecencyDbPath,
  historyDbPath: args.historyDbPath ?? historyDbPath,
});
if (!finderResult.ok) { console.error('Failed to create FileFinder:', finderResult.error); process.exit(1); }
const finder = finderResult.value;

console.log('→ Scanning...');
const scanDone = await finder.waitForScan(30000);
if (!scanDone.ok || !scanDone.value) console.warn('Scan timeout, proceeding anyway...');

const progress = finder.getScanProgress();
if (progress.ok) {
  console.log(`  Indexed ${progress.value.scannedFilesCount} files${progress.value.isScanning ? ' (scanning...)' : ''}`);
}

const dbInfo = [];
if (args.frecencyDbPath ?? frecencyDbPath) dbInfo.push('frecency');
if (args.historyDbPath ?? historyDbPath) dbInfo.push('history');
if (dbInfo.length > 0) console.log(`  Using DBs: ${dbInfo.join(', ')}`);

if (!args.pattern) {
  console.log(`\n✅ Scanned ${progress.ok ? progress.value.scannedFilesCount : '?'} files.`);
  process.exit(0);
}

let result, queryDesc;
if (args.mode === 'find') {
  queryDesc = `fileSearch: "${buildQuery(args.constraints, args.pattern)}"`;
  console.log(`→ Warming frecency/history: ${queryDesc}`);
  const searchResult = finder.fileSearch(buildQuery(args.constraints, args.pattern), {
    pageSize: args.limit,
  });
  if (!searchResult.ok) { console.error('Search failed:', searchResult.error); process.exit(1); }
  result = searchResult.value;
  const shown = result.items.slice(0, args.limit);
  console.log(`  Wrote ${shown.length} file(s) to frecency DB`);
} else {
  queryDesc = `grep: "${buildQuery(args.constraints, args.pattern)}"`;
  console.log(`→ Warming frecency/history: ${queryDesc}`);
  const grepResult = finder.grep(buildQuery(args.constraints, args.pattern), {
    mode: resolveGrepMode(args.pattern, args.literal),
    smartCase: !args.ignoreCase,
    maxMatchesPerFile: Math.min(Math.max(1, args.limit), 50),
    beforeContext: args.context, afterContext: args.context,
    classifyDefinitions: true,
  });
  if (!grepResult.ok) { console.error('Grep failed:', grepResult.error); process.exit(1); }
  result = grepResult.value;
  const filesTouched = new Set(result.items.map(i => i.relativePath));
  console.log(`  Wrote ${result.items.length} match(es) across ${filesTouched.size} file(s) to frecency DB`);
}

console.log(`\n✅ Scan + warm complete.`);
