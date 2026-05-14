# fff-cli

CLI file search tools using `@ff-labs/fff-node` library part of the amazing [fff - file search library](https://github.com/dmtrKovalenko/fff). The tools can be used in Daemon Mode, or (much less efficient, but compatible) Standalone (Non-Daemon) Mode.

## Tools

| Command | Purpose |
|---|---|
| `ffgrep` | Content search: regex and literal grep with frecency ranking |
| `fffind` | Fuzzy file finder: search by path with frecency ranking |
| `fff-multi-grep` | SIMD multi-pattern OR search (Aho-Corasick) |
| `fff-daemon` | Long-running indexer + IPC server for instant queries |

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

### fff-daemon

```bash
Usage: fff-daemon [directory|command] [options]

Server mode:
  fff-daemon               Start daemon for current directory
  fff-daemon ~/my-project  Start daemon for specific directory

Client control:
  fff-daemon scan          Trigger a rescan in the running daemon
  fff-daemon health        Show daemon status
  fff-daemon shutdown      Stop the running daemon

Options:
  --frecency-db <path>     Frecency DB
  --history-db <path>      History DB
  --sock <path>            Unix socket path (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)
  --help                   Show this message
```

### ffgrep

```bash
Usage: ffgrep <pattern> [options]
Options:
  -c, --constraints <...>   Path filter constraints
  -i, --ignore-case         Case-insensitive (default: smartCase)
  -e, --regex               Force regex
      --literal             Force literal
      --context <N>         Context lines before and after each match
  -b, --before-context <N>  Lines before each match
  -a, --after-context <N>   Lines after each match
  -l, --limit <N>           Max matches per file, capped at 50 (default: 100)
  -n, --cursor <id>         Page number (default: 1)
  -s, --sock <path>         Daemon socket (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)

Standalone Options (Non-Daemon mode):
      --base <path>         Base directory
      --frecency-db <path>  Frecency DB
      --history-db <path>   History DB

      --help                Show this message
```

### fffind

```bash
Usage: fffind <pattern> [options]
Options:
  -c, --constraints <...>   Path filter constraints
  -l, --limit <N>           Max results per page (default: 30)
  -n, --cursor <id>         Page number (default: 1)
  -s, --sock <path>         Daemon socket (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)

Standalone Options (Non-Daemon mode):
      --base <path>         Base directory
      --frecency-db <path>  Frecency DB
      --history-db <path>   History DB

      --help                Show this message
```

### fff-multi-grep

```bash
Usage: fff-multi-grep <p1,p2,...> [options]
Options:
  -c, --constraints <...>   Path filter constraints
  -i, --ignore-case         Case-insensitive (default: smartCase)
      --context <N>         Lines before and after each match
  -b, --before-context <N>  Lines before each match
  -a, --after-context <N>   Lines after each match
  -l, --limit <N>           Max matches per file, capped at 50 (default: 100)
  -n, --cursor <id>         Page number (default: 1)
  -s, --sock <path>         Daemon socket (default: $FFF_DAEMON_SOCK or /tmp/fff.sock)

Standalone Options (Non-Daemon mode):
      --base <path>         Base directory
      --frecency-db <path>  Frecency DB
      --history-db <path>   History DB

      --help                Show this message
```

## Full docs

- [`docs/fff-daemon.md`](docs/fff-daemon.md)
- [`docs/ffgrep.md`](docs/ffgrep.md)
- [`docs/fffind.md`](docs/fffind.md)
- [`docs/fff-multi-grep.md`](docs/fff-multi-grep.md)

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_FRECENCY_DB` | Frecency database directory |
| `FFF_HISTORY_DB` | Query history database directory |
| `FFF_CURSORS_DIR` | Cursor JSON storage directory (default: `/tmp`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`) |
| `FFF_FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |

## Acknowledgements

Thanks [fff](https://github.com/dmtrKovalenko/fff)
