# fff-multi-grep

OR-logic multi-pattern content search using SIMD-accelerated Aho-Corasick matching. Faster than regex alternation (`foo|bar|baz`) for literal text searches because it uses a single SIMD scan instead of backtracking.

## Usage

```bash
fff-multi-grep <p1,p2,...> [options]
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `--constraints` | string | — | File constraints (e.g. `"*.ts !test/"`) |
| `--ignore-case` | flag | false | Force case-insensitive matching |
| `--context` | number | 0 | Context lines before and after each match |
| `--limit` | number | 100 | Maximum matches **per file** (capped at 50). Not a total page — all matching files are included, each limited to this value. |
| `--cursor` | string | 1 | Page number to resume (default: 1, same as no `--cursor`) |
| `--base` | path | `cwd` | Base directory to search |
| `--frecency-db` | path | — | Path to frecency database directory |
| `--history-db` | path | — | Path to query history database directory |

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |
| `FFF_FRECENCY_DB` | Override frecency database path |
| `FFF_HISTORY_DB` | Override query history database path |
| `FFF_CURSORS_DIR` | Cursor storage directory (default: `/tmp`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`) |

The CLI auto-detects databases in this order:
1. `{basePath}/.local/share/fff/{frecency,history}` (project-local)
2. `~/.local/share/fff/{frecency,history}` (user home)

## Daemon mode

If `fff-daemon` is running for `--base`, `fff-multi-grep` connects via Unix domain socket and searches the warm in-memory index instantly. Falls back to local mode automatically if no daemon is listening.

## How it works

- Creates an FFF `FileFinder` for the base directory
- Uses SIMD-accelerated **Aho-Corasick** multi-pattern matching
- Searches for lines matching **ANY** of the provided patterns (OR logic)
- Patterns are **literal** — no regex metacharacters are interpreted
- Results are ranked by **frecency** (most-accessed files first)
- Matches within a file stay in source order

## Why use this over `ffgrep`?

| Use case | Tool |
|---|---|
| Single pattern, possibly regex | `ffgrep` |
| Multiple patterns, all literal, OR logic | `fff-multi-grep` (faster) |
| Searching for naming variants (`fooBar`, `foo_bar`, `FooBar`) | `fff-multi-grep` |

`fff-multi-grep` is measurably faster than `ffgrep --regex "fooBar|foo_bar|FooBar"` because it avoids regex compilation and backtracking.

## Examples

### Single pattern

```bash
fff-multi-grep "registerCommand" --base /Users/jeffrey/.pi/agent --limit 3
```

```
.local/lib/ffgrep.md
  51: ffgrep "registerCommand" --limit 5
  56: 537: pi.registerCommand("org-cli-info", {
  59: 10: pi.registerCommand("exit", {

Matched 5 lines across 2735 files searched (2735 eligible)
```

### Multiple patterns (the sweet spot)

```bash
fff-multi-grep "registerCommand,registerTool" \
  --base /Users/jeffrey/.pi/agent \
  --constraints "extensions" \
  --limit 5
```

```
.local/lib/ffgrep.md
  51: ffgrep "registerCommand" --limit 5
  56: 537: pi.registerCommand("org-cli-info", {
  59: 10: pi.registerCommand("exit", {
  67: ffgrep "registerTool" --path "extensions/emacs-org-cli.ts" --context 2 --limit 5
 113: ffgrep "registerCommand|registerTool" --literal --limit 3

Matched 5 lines across 22 files searched (22 eligible)
```

### Naming convention variants

```bash
fff-multi-grep "TypeDecorator,TypeEngine" \
  --base /Users/jeffrey/.pi/agent/.local/share/dedoc \
  --constraints "sqlalchemy/core" \
  --limit 3
```

```
docsets/sqlalchemy/changelog/changelog_01.html
  15: types types types! still weren't working….have to use TypeDecorator again :(
 163: overhaul to the construction of the types system...
```

## About `--limit`

`--limit` controls `maxMatchesPerFile` — the most matching lines returned from any
single file. It is **not** a total page cap: if 15 files match, you get up to
15 × limit lines.

| `--limit` | Effective per-file cap |
|---|---|
| 1–50 | The value passed |
| 51–100 | 50 (hard engine ceiling) |

```bash
fff-multi-grep "TODO,FIXME" --limit 3   # 3 lines per matching file
fff-multi-grep "TODO,FIXME" --limit 50  # Up to 50 lines per matching file
```

## Pagination

Pages resume from a byte offset, not a fixed line count. Because each page
includes every matching file (up to the per-file `--limit`), page sizes vary
with the number of matching files.

```bash
fff-multi-grep "a,b,c" --limit 50
# → [50+ matches (refine patterns). Continue with cursor="2"]

fff-multi-grep "a,b,c" --cursor 2 --limit 50
# → [50+ matches (refine patterns). Continue with cursor="3"]
```

Page numbers are independent per `patterns|constraints|limit` namespace.
Cursor state is stored in `${FFF_CURSORS_DIR:-/tmp}/fff-multi-grep-cursors.json`
and expires after 24 hours or when the store exceeds 200 entries.

## Important notes

- **Patterns are always literal** — there is no `--regex` flag
- **Include all naming-convention variants** you care about: `foo_bar`, `fooBar`, `FooBar`
- Use `--constraints` for file filtering
