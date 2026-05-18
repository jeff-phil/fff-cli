# fff-multi-grep

OR-logic multi-pattern content search using SIMD-accelerated Aho-Corasick matching. Faster than regex alternation used by `ffgrep` (`foo|bar|baz`) for literal text searches because it uses a single SIMD scan instead of backtracking.

"Daemon Mode" is when `fff-multi-grep` connects to a running `fff-daemon` socket for queries. In "Standalone", or Non-Daemon Mode, `fff-multi-grep` will scan before each query resulting which will affect performance returning results.


## Usage

```bash
fff-multi-grep <p1,p2,...> [options]
```

## Parameters

### Parameters for both Daemon and Standalone modes

| Parameter | Type | Default | Description |
|---|---|---|---|
| `-c`, `--constraints` | string | — | Path file constraints (e.g. `"*.ts !test/"`) |
| `-i`, `--ignore-case` | flag | false | Force case-insensitive matching (default: smartCase) |
| `--context` | number | 0 | Lines of context before **and** after each match. Sets both `--before-context` and `--after-context`. |
| `-b`, `--before-context` | number | 0 | Lines to show before each match |
| `-a`, `--after-context` | number | 0 | Lines to show after each match |
| `-l`, `--limit` | number | 100 | Maximum matches **per file** (capped at 50). Not a total page — all matching files are included, each limited to this value. |
| `-n`, `--cursor` | string | 1 | Page number to resume (default: 1, same as no `--cursor`) |
| `-s`, `--sock` | path | — | Unix socket for `fff-daemon` (overrides `FFF_DAEMON_SOCK`) |

### Parameters for only Standalone (Non-Daemon) mode

| Parameter | Type | Default | Description |
|---|---|---|---|
| `--base` | path | `cwd` | Base directory to search |
| `--frecency-db` | path | — | Path to frecency database directory |
| `--history-db` | path | — | Path to query history database directory |

## Environment variables

| Variable | Effect |
|---|---|
| `FFF_FRECENCY_DB` | Override frecency database path |
| `FFF_HISTORY_DB` | Override query history database path |
| `FFF_CURSORS_DIR` | Cursor storage directory (default: `~/.local/cache/fff/cursors`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`). Overridden by `--sock` |
| `FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |

The CLI auto-detects databases in this order:
1. `{basePath}/.fff/{frecency,history}` (project-local)
2. `~/.local/cache/fff/{frecency,history}` (user home)

## Daemon mode

If `fff-daemon` is running for `--base`, `fff-multi-grep` connects via Unix domain socket and searches the warm in-memory index instantly. Falls back to local Standalone mode automatically if no daemon is listening.

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

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fff-multi-grep "registerCommand" --base ~/projects/my-project --limit 3
```

```
~/projects/my-project/docs/ffgrep.md
  51: ffgrep "registerCommand" --limit 5
  56: 537: pi.registerCommand("org-cli-info", {
  59: 10: pi.registerCommand("exit", {

Matched 5 lines across 2735 files searched (2735 eligible)
```

### Multiple patterns (the sweet spot)

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fff-multi-grep "registerCommand,registerTool" \
  --base ~/projects/my-project \
  --constraints "extensions" \
  --limit 5
```

```
~/projects/my-project/docs/ffgrep.md
  51: ffgrep "registerCommand" --limit 5
  56: 537: pi.registerCommand("org-cli-info", {
  59: 10: pi.registerCommand("exit", {
  67: ffgrep "registerTool" --context 2 --limit 5
 113: ffgrep "registerCommand|registerTool" --literal --limit 3

Matched 5 lines across 22 files searched (22 eligible)
```

### Naming convention variants

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fff-multi-grep "TypeDecorator,TypeEngine" \
  --base ~/projects/my-project \
  --constraints "models/core" \
  --limit 3
```

```
~/projects/my-project/docsets/sqlalchemy/changelog/changelog_01.html
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
Cursor state is stored in `${FFF_CURSORS_DIR:-~/.local/cache/fff/cursors}/fff-multi-grep-cursors.json`
and expires after 24 hours or when the store exceeds 200 entries.

## `--constraints` examples

Constraints are normalized before being sent to the search engine. Bare directory names
are expanded to recursive globs, glob patterns and file extensions pass through as-is,
and consecutive bare-dir constraints are grouped into a single brace group for better
engine performance. Brace groups with commas are always preserved as-is.

| Constraint | Normalized to | Meaning |
|---|---|---|
| `src` | `src/**` | All files under `src/` recursively |
| `src/` | `src/**` | Same as above (trailing `/` stripped) |
| `src/**` | `src/**` | Same as above (already a glob) |
| `src/**/tests` | `src/**/tests/**` | Any `tests/` dir anywhere under `src/` |
| `*.ts` | `*.ts` | Only `.ts` files |
| `*.{ts,tsx}` | `*.{ts,tsx}` | Only `.ts` and `.tsx` files |
| `!node_modules/` | `!node_modules/**` | Exclude `node_modules/` |
| `!*.min.js` | `!*.min.js` | Exclude minified JS files |
| `python pydantic` | `{python/**,pydantic/**}` | Under `python/` **or** `pydantic/` |
| `python pydantic !pydantic/**/api` | `{python/**,pydantic/**} !pydantic/**/api/**` | Under `python/` **or** `pydantic/`, but not `pydantic/api/` or `pydantic/foo/api/` |
| `{python/**,pydantic/**}` | `{python/**,pydantic/**}` | Passed through unchanged |
| `src/ !src/test/` | `{src/**} !src/test/**` | Under `src/` but not `src/test/` |
| `./docs` | `docs/**` | Leading `./` is stripped |

Constraints are space-separated (AND logic). Do not use commas — commas inside `{...}` brace groups are part of the glob syntax and must be preserved.

```bash
# Only .ts and .tsx files, excluding test directories
fff-multi-grep "createElement,createElementNS" -c '*.{ts,tsx} !test/'

# Under src/ but not under src/generated/
fff-multi-grep "TODO,FIXME" -c 'src/ !src/generated/'
```

## Important notes

- **Patterns are always literal** — there is no `--regex` flag
- **Include all naming-convention variants** you care about: `foo_bar`, `fooBar`, `FooBar`
- Use `--constraints` for file filtering
- Bare directory names in constraints are auto-expanded to recursive globs (`src` → `src/**`)
- Negate constraints with `!` (e.g. `!node_modules/`)
