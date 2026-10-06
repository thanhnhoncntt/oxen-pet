# Security audit

oxen-pet is a fork of [pixel-pet](https://github.com/Namenomeaning/pixel-pet) (MIT). It exists so
that every line that runs inside Claude Code comes from this repo, read before it ships, instead
of from a third-party marketplace that updates itself.

## Audited upstream

| | |
| --- | --- |
| Upstream | `https://github.com/Namenomeaning/pixel-pet` (remote `upstream`, push disabled) |
| Commit | `02eb10af1788ee0514ed72ee3bf1cb7ad46b0764` (2026-10-03) |
| Audited | 2026-10-05 |
| Result | No network, process, environment, or dynamic-code access. One unrestricted file write, now restricted (below). |

## What the mod can do

From `claude plugin validate plugins/oxen-pet --strict`:

```
calls: $.agent.list, $.clock.every, $.clock.now, $.command.register, $.fs.list, $.fs.read, $.fs.stat,
       $.fs.write, $.session.usage, $.state.get, $.state.set, $.store.delete, $.store.get, $.store.set,
       $.tool.register, $.ui.ask, $.ui.close, $.ui.invalidate, $.ui.open, $.ui.panes, $.ui.resolve,
       $.ui.status, $.ui.toast
```

| Call | Used for |
| --- | --- |
| `$.fs.read` | A built-in theme under the plugin's own root (`assets/<name>.json`), and the user's `<name>.theme.json` in their custom folder. A name is letters, digits, `-` and `_` only, so a read stays in that folder |
| `$.fs.exists` | Whether the custom folder has `<name>.theme.json`, before the built-in theme of that name |
| `$.fs.stat` | `preview_theme`: where the path leads, before writing. The shield: what an `rm` target is |
| `$.fs.list` | `/pet theme`: the `.theme.json` files in the custom folder. The shield: counts the files under an `rm` target, up to 2000 files, 8 folders deep and 300 folders; never follows a symbolic link. Names are counted, never kept |
| `$.fs.write` | `preview_theme` only, to an absolute path whose file name is `oxen-pet-preview*.html` with no `..`, in a folder that already exists, and that is not a symbolic link and lands on an `oxen-pet-preview*.html` file (`hooks/previewPath.ts`) |
| `$.session.usage` | context and rate-limit numbers for the HUD |
| `$.agent.list` | count of running subagents, for the minis |
| `$.store.*` | the theme `set_theme` keeps |
| `$.state.*` | the pet's animation state |
| `$.tool.register` | `get_theme`, `preview_theme`, `set_theme` |
| `$.ui.ask` | The shield's Block it / Run it question |
| `$.command.register`, `$.ui.open`, `$.ui.close`, `$.ui.panes` | `/pet` and its pane |

`tool.call` sees every tool's input. It keeps only a short target (file name, pattern, first 24
characters of a Bash command, host, query) for the status line, and only when the **Name files and
commands** setting is on. It is off by default in this fork.

## Checks

Run from the repo root. Each must print nothing beyond what is listed.

```bash
# Network, processes, environment, dynamic code, in shipped code
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|https?://|child_process|spawn|exec\(|process\.|require\(|import\(|eval\(|new Function" \
  plugins/oxen-pet --include='*.ts' --include='*.tsx' | grep -v '\.test\.ts'
# expected: pixels.ts — the SVG namespace string "http://www.w3.org/2000/svg" only

# Imports: only claude-code and the mod's own modules
grep -rhoE "from '[^']+'" plugins/oxen-pet/hooks --include='*.ts' --include='*.tsx' | sort -u

# The preview page loads nothing from outside (inline <script> only)
grep -nE "src=|href=|<link|@import|url\(" plugins/oxen-pet/hooks/preview.ts
```

## Changes from upstream

1. Renamed to `oxen-pet` (plugin, marketplace, tools `mcp__oxen-pet__*`, state key, skill).
2. `preview_theme` writes only `oxen-pet-preview*.html` at an absolute path with no `..`, into a
   folder that already exists, and refuses a symbolic link at that path (checked with
   `$.fs.stat(path, { resolve: true })`). Upstream wrote to any path Claude passed, so a
   prompt-injected call could overwrite any file the user can write, for example through a symlink
   committed to a cloned repo.

   Known limits: a hard link at an allowed name, and a link swapped in between the check and the
   write, both need someone who can already write to that folder.
3. **Name files and commands** (`targets`) defaults to off.
4. Removed `tools/demo/` (it spawned Chrome and ffmpeg) and `docs/images/`. Both came back on
   2026-10-05 for the README's demo GIF: `tools/demo/record.mjs` is a developer tool that a person runs
   by hand. It lives outside `plugins/oxen-pet`, so no install ships it and Claude Code never loads it.
   It starts a headless Chrome and ffmpeg, talks to Chrome's DevTools on `127.0.0.1` only, and writes
   only `docs/images/demo.gif` and `hud.png` (or the path given) and a temp folder it deletes. The
   checks above cover `plugins/oxen-pet` alone on purpose.
5. 1.0.2 adds a `turn.complete` hook that only observes: it notes when the main thread's turn ended,
   for the cache timer, and passes the turn through unchanged.
6. 1.1.0 adds the mod's first hook that can refuse a call: `tool.check` on Bash (the shield). It
   only changes Claude Code's verdict when that verdict is `allow` and the command matches a
   destructive pattern in `hooks/guard.ts`; it then answers `allow` only on the user's **Run it**,
   and `deny` otherwise, including when no one can answer. A `deny` from Claude Code passes through;
   an `ask` gets only a new reason. A query (`$.tool.check` with no `tool_use_id`) is never asked
   about. If the classifier throws, Claude Code's verdict stands. **Shield** (`guard`) turns it off.
   The `tool.call` hook also reads a Bash command to tell a test run (`hooks/boss.ts`) and keeps
   counts, never the command, for `/pet`.
7. The custom folder (1.1.0): the mod reads themes from `~/.claude/oxen-pet/themes` (found from the plugin's
   install path, since the mod reads no environment) or the absolute path the **Custom folder** setting
   gives, with no `..`, `~` or `$`. It reads only `<name>.theme.json` for a name of letters, digits, `-` and
   `_`, and never writes there. A theme from it goes through `readTheme` like any other.

## Taking an upstream change

Never install upstream's marketplace. To bring in a change:

```bash
git fetch upstream
git log --oneline main..upstream/main
git diff main...upstream/main -- plugins/pixel-pet   # read every line
git cherry-pick <sha>                                # resolve the pixel-pet → oxen-pet rename
```

Then re-run the checks above, `claude plugin validate plugins/oxen-pet --strict` (compare its
`calls:` line with the table), and `claude plugin test plugins/oxen-pet`. Update the audited commit
in this file, bump `version` in `plugins/oxen-pet/.claude-plugin/plugin.json`, and push.
