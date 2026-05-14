# fff-cli

Standalone CLI tools around `@ff-labs/fff-node` — the same fast file finder engine that powers the pi coding agent. Use these on any machine with Node.js, with or without pi installed.

## Tools

| Command | Purpose |
|---|---|
| `ffgrep` | Content search: regex and literal grep with frecency ranking |
| `fffind` | Fuzzy file finder: search by path with frecency ranking |
| `fff-multi-grep` | SIMD multi-pattern OR search (Aho-Corasick) |
| `fff-daemon` | Long-running indexer + IPC server for instant queries |
| `fff-scan` | Pre-scan a directory and warm frecency/history DBs |

## Installation

### Global install (recommended)

```bash
npm install -g @ff-labs/fff-node
# Clone or copy this fff-cli directory anywhere
node fff-cli/bin/ffgrep --help
```

### Or put `bin/` on your PATH

```bash
export PATH="$PATH:/path/to/fff-cli/bin"
ffgrep "console.log" --base ~/my-project
```

### Or symlink individual tools

The scripts resolve their internal modules relative to their **real source directory**, so symlinking works at any depth:

```bash
ln -s /projects/fff-cli/bin/ffgrep ~/.local/bin/ffgrep
ln -s /projects/fff-cli/bin/fffind ~/.local/bin/fffind
ln -s /projects/fff-cli/bin/fff-multi-grep ~/.local/bin/fff-multi-grep
ln -s /projects/fff-cli/bin/fff-scan ~/.local/bin/fff-scan
ln -s /projects/fff-cli/bin/fff-daemon ~/.local/bin/fff-daemon
```

## `@ff-labs/fff-node` resolution

The tools auto-discover `@ff-labs/fff-node` via:

1. **`FFF_FFF_NODE_PATH`** env var (highest priority)
2. Direct dependency in `node_modules`
3. Through `@ff-labs/pi-fff` dependency
4. `npm config get prefix` global path
5. Common global npm paths (`/usr/local/lib/node_modules`, `~/.npm-global`, etc.)

Set it explicitly if FFF is installed somewhere unusual:
```bash
export FFF_FFF_NODE_PATH=/custom/path/@ff-labs/fff-node/dist/src/index.js
```

## Quick Reference

### ffgrep

```bash
ffgrep <pattern> [options]

Options:
  --constraints <...>   Path filters (e.g. "src/ *.ts !test/ !*.min.js")
  --ignore-case         Force case-insensitive
  --regex               Treat pattern as regex
  --literal             Force literal string
  --context <N>         Context lines (default: 0)
  --limit <N>           Max matches (default: 100)
  --cursor <id>         Pagination cursor
  --base <path>         Base directory (default: cwd)
  --frecency-db <path>  Frecency DB path
  --history-db <path>   History DB path
```

### fffind

```bash
fffind <pattern> [options]

Options:
  --base <path>         Base directory (default: cwd)
  --constraints <...>   Path filters
  --limit <N>           Max results per page (default: 30)
  --cursor <id>         Pagination cursor
  --frecency-db <path>  Frecency DB path
  --history-db <path>   History DB path
```

### fff-multi-grep

```bash
fff-multi-grep <p1,p2,...> [options]

Options:
  --constraints <...>   File filters
  --ignore-case
  --context <N>
  --limit <N>
  --cursor <id>
  --base <path>
  --frecency-db <path>
  --history-db <path>
```

## Full docs

- [`docs/ffgrep.md`](docs/ffgrep.md)
- [`docs/fffind.md`](docs/fffind.md)
- [`docs/fff-multi-grep.md`](docs/fff-multi-grep.md)
- [`docs/fff-daemon.md`](docs/fff-daemon.md)
- [`docs/fff-scan.md`](docs/fff-scan.md)

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |
| `FFF_FRECENCY_DB` | Frecency database directory |
| `FFF_HISTORY_DB` | Query history database directory |
| `FFF_CURSORS_DIR` | Cursor JSON storage directory (default: `/tmp`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`) |
