# fffind

Fuzzy file search using FFF (Fast File Finder). Matches against the whole repo-relative path, not just the filename.

"Daemon Mode" is when `fffind` connects to a running `fff-daemon` socket for queries. In "Standalone", or Non-Daemon Mode, `fffind` will scan before each query resulting which will affect performance of returned results.


## Usage

```bash
fffind <pattern> [options]
```

## Parameters

### Parameters for both Daemon and Standalone modes

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pattern` | string | *(required)* | Fuzzy search pattern (matches against whole path) |
| `-c`, `--constraints` | string | — | Path constraints: includes and excludes (e.g. `"src/ *.ts !test/ !*.min.js"`) |
| `-l`, `--limit` | number | 30 | Maximum results per page |
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
| `FFF_CURSORS_DIR` | Cursor storage directory (default: `/tmp`) |
| `FFF_DAEMON_SOCK` | Unix socket path for `fff-daemon` (default: `/tmp/fff.sock`). Overridden by `--sock` |
| `FFF_NODE_PATH` | Override `@ff-labs/fff-node` module path |

The CLI auto-detects databases in this order:
1. `{basePath}/.local/share/fff/{frecency,history}` (project-local)
2. `~/.local/share/fff/{frecency,history}` (user home)

## Constraints syntax

| Constraint | Meaning |
|---|---|
| `src/` | Only search in `src/` directory |
| `*.ts` | Only match `.ts` files |
| `src/**/*.ts` | Only match `.ts` files under `src/` |
| `!test/` | Exclude `test/` directory |
| `!*.min.js` | Exclude minified JS files |
| `"src/ *.ts !test/ !*.min.js"` | Include `src/`, `.ts` files; exclude `test/` and minified JS |

## Daemon mode

If `fff-daemon` is running for `--base`, `fffind` connects via Unix domain socket and searches the warm in-memory index instantly. Falls back to local Standalone mode automatically if no daemon is listening.

## How it works

- Creates an FFF `FileFinder` for the base directory
- Waits for the initial file scan to complete
- Searches the **entire repo-relative path**, not just the filename
- **Multi-word queries** narrow results (AND logic, not order-bound)
- Results are ranked by **frecency** (most-accessed files first)
- Fuzzy matching supports typos and partial matches

## Output annotations

Files may be annotated with:

| Annotation | Meaning |
|---|---|
| `[modified in git]` | File has uncommitted changes |
| `[staged_new in git]` | New file, staged for commit |
| `[untracked in git]` | New file, not tracked by git |
| `[often touched file]` | High frecency score |
| `[VERY often touched file]` | Very high frecency score |

## Examples

### Basic search

```bash
fffind "exit" --limit 5
```

```
Found 2731 matches across 2744 indexed files

.local/share/dedoc/docsets/daily/daily-js/instance-methods/exit-fullscreen.html
.local/share/dedoc/docsets/elisp/query-before-exit.html
.local/share/dedoc/docsets/elisp/nonlocal-exits.html
extensions/exit-command.ts
.local/share/dedoc/docsets/python~3.14/library/atexit.html

[2726 more matches available. cursor="2" to continue]
```

### With constraints

```bash
fffind "decorator" \
  --base ~/.pi/agent/.local/share/dedoc \
  --constraints "docsets/sqlalchemy" \
  --limit 3
```

```
Found 95 matches across 2674 indexed files

docsets/sqlalchemy/core/operators.html
docsets/sqlalchemy/orm/relationship_persistence.html
docsets/sqlalchemy/orm/mapped_attributes.html

[92 more matches available. cursor="1" to continue]
```

### Glob search

```bash
fffind "*.ts" --limit 8
```

```
Found 3 matches across 2744 indexed files

extensions/emacs-org-cli.ts
extensions/exit-command.ts
extensions/git-guardrails.ts
```

### Exclude paths

```bash
fffind "exit" --limit 3 --constraints "!.local/"
```

```
Found 55 matches across 2744 indexed files

extensions/exit-command.ts
extensions/git-guardrails.ts
extensions/emacs-org-cli.ts

[52 more matches available. cursor="4" to continue]
```

## Pagination

Pagination is **page-number based** (1-based). Each query gets its own independent cursor namespace keyed by `pattern|constraints|limit`.

```bash
# Page 1 (default)
fffind "exit" --limit 5
# → [2726 more matches available. cursor="2" to continue]

# Page 2
fffind "exit" --limit 5 --cursor 2
# → [2724 more matches available. cursor="3" to continue]

# A different query starts fresh at page 1
fffind "console" --limit 5
# → [cursor="2"]
```

Page numbers are independent per query. `--cursor 1` is the same as not using `--cursor` at all. Cursors are stored in `${FFF_CURSORS_DIR:-/tmp}/fffind-cursors.json` and expire after 24 hours or when the global store exceeds 200 entries.

## Query tips

- **Match the whole path**, not just the filename — `profile` hits `chrome/browser/profiles/x.cc` too
- **Keep queries to 1–2 terms**; extra words narrow the results
- **Use for paths, not content** — use `ffgrep` for content search
- **For exact filename matches**, use a glob in `--constraints` (e.g. `--constraints '**/profile.h'`)
- **To list a directory**, pass `--constraints 'dir/**'` with a `*` or empty pattern
- **Use exclusions** to cut noise in large repos (e.g. `--constraints '!test/ !*.min.js'`)
