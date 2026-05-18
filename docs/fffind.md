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
| `-p`, `--page-size` | number | 30 | Alias for `--limit` |
| `-n`, `--cursor` | string | 1 | Page number to resume (default: 1, same as no `--cursor`) |
| `-s`, `--sock` | path | — | Unix socket for `fff-daemon` (overrides `FFF_DAEMON_SOCK`) |


### Parameters for only Standalone (Non-Daemon) mode

| Parameter | Type | Default | Description |
|---|---|---|---|
| `--base` | path | `cwd` | Base directory to search. Passing this flag forces standalone (non-daemon) mode. |
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

## Constraints syntax

`--constraints` accepts a space-separated string of path filters. Constraints are normalized:

- **Bare directory names** are expanded to recursive globs (`src` → `src/**`).
- **Glob patterns and file extensions** pass through as-is (`*.{ts,tsx}`, `*.py`).
- **Brace groups** `{a,b,c}` are preserved and commas inside them are left untouched.
- **Consecutive bare-dir constraints** are grouped into a single brace group for better engine performance: `python pydantic` → `{python/**,pydantic/**}`.
- **Negated constraints** (`!`) keep their exclusion semantics.

| Constraint | Normalized to | Meaning |
|---|---|---|
| `src/` | `src/**` | Only search in `src/` directory |
| `*.ts` | `*.ts` | Only match `.ts` files |
| `src/**/*.ts` | `src/**/*.ts` | Only match `.ts` files under `src/` |
| `!test/` | `!test/**` | Exclude `test/` directory |
| `!*.min.js` | `!*.min.js` | Exclude minified JS files |
| `python pydantic` | `{python/**,pydantic/**}` | Under `python/` **or** `pydantic/` |
| `python pydantic !pydantic/**/api` | `{python/**,pydantic/**} !pydantic/**/api/**` | Under `python/` **or** `pydantic/`, but not `pydantic/api/` or `pydantic/foo/api/` |
| `src/ *.ts !test/` | `src/** *.ts !test/**` | Include `src/` and `*.ts`, exclude `test/` |
| `{python/**,pydantic/**}` | `{python/**,pydantic/**}` | Passed through unchanged |

## Daemon mode

If `fff-daemon` is running, `fffind` connects via Unix domain socket and searches the warm in-memory index instantly. Falls back to local Standalone mode automatically if no daemon is listening. Passing `--base` forces standalone (non-daemon) mode.

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

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fffind "exit" --base ~/projects/my-project --limit 5 --sock /tmp/fff-devdocs.sock
```

```
→ [via daemon /tmp/fff-devdocs.sock] Searching: "exit"

Found 2187 matches across 2646 indexed files

~/projects/my-project/elisp/query-before-exit.md
~/projects/my-project/elisp/nonlocal-exits.md
~/projects/my-project/daily/daily-js/instance-methods/exit-fullscreen.md
~/projects/my-project/python/library/atexit.md
~/projects/my-project/elisp/explicit-debug.md

[2182 more matches available. cursor="2" to continue]

```

### With constraints

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fffind "decorator" \
  --base ~/projects/my-project \
  --constraints "sqlalchemy" \
  --limit 3
```

```
→ [via daemon /tmp/fff-devdocs.sock] Searching: "sqlalchemy/ decorator"

Found 16 matches across 2646 indexed files

~/projects/my-project/sqlalchemy/core/operators.md
~/projects/my-project/sqlalchemy/_modules/examples/generic_associations/discriminator_on_association.md
~/projects/my-project/sqlalchemy/orm/declarative_config.md

[13 more matches available. cursor="2" to continue]
```

### Glob search

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fffind "*.ts" --base ~/projects/my-project --limit 8
```

```
Found 3 matches across 2744 indexed files

~/projects/my-project/extensions/emacs-org-cli.ts
~/projects/my-project/extensions/exit-command.ts
~/projects/my-project/extensions/git-guardrails.ts
```

### Exclude paths

> **Note:** Matched paths are always printed as full paths, prefixed with the `basePath`.

```bash
fffind "exit" --base ~/projects/my-project --limit 3 --constraints "!.local/"
```

```
Found 55 matches across 2744 indexed files

~/projects/my-project/extensions/exit-command.ts
~/projects/my-project/extensions/git-guardrails.ts
~/projects/my-project/extensions/emacs-org-cli.ts

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

Page numbers are independent per query. `--cursor 1` is the same as not using `--cursor` at all. Cursors are stored in `${FFF_CURSORS_DIR:-~/.local/cache/fff/cursors}/fffind-cursors.json` and expire after 24 hours or when the global store exceeds 200 entries.

## Query tips

- **Match the whole path**, not just the filename — `profile` hits `chrome/browser/profiles/x.cc` too
- **Keep queries to 1–2 terms**; extra words narrow the results
- **Use for paths, not content** — use `ffgrep` or `fff-multi-grep` for content searches
- **For exact filename matches**, use a glob in `--constraints` (e.g. `--constraints '**/profile.h'`)
- **To list a directory**, pass `--constraints 'dir'` with a `*` or empty pattern
- **Use exclusions** to cut noise in large repos (e.g. `--constraints '!test !*.min.js'`)
