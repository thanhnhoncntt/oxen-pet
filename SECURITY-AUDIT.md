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
   `tools/demo/meter.mjs` (2026-10-06) records oxen-meter's guide the same way, from the meter's own modules: it
   starts a headless Chrome and ffmpeg, talks to Chrome's DevTools on `127.0.0.1` only, and writes only
   `docs/images/meter-demo.gif`, `meter-pane.png` and `meter-report.png` (or beside the path given) and a temp folder
   it deletes, once Chrome has exited. It lives outside `plugins/` and `tools/meter`, so no install ships it, no hook
   runs it, and neither the mod's checks nor the companion's cover it.
5. 1.0.2 adds a `turn.complete` hook that only observes: it notes when the main thread's turn ended,
   for the cache timer, and passes the turn through unchanged.
6. 1.1.0 adds the mod's first hook that can refuse a call: `tool.check` on Bash (the shield). It
   only changes Claude Code's verdict when that verdict is `allow` and the command matches a
   destructive pattern in `hooks/guard.ts`; it then answers `allow` only on the user's **Run it**,
   and `deny` otherwise, including when no one can answer. A `deny` from Claude Code passes through;
   an `ask` gets only a new reason. A query (`$.tool.check` with no `tool_use_id`) is never asked
   about. If the classifier throws, Claude Code's verdict stands. **Shield** (`guard`) turns it on: since 1.1.3
   it is off by default, and the hook then passes every call on untouched.
   The `tool.call` hook also reads a Bash command to tell a test run (`hooks/boss.ts`) and keeps
   counts, never the command, for `/pet`.
7. The custom folder (1.1.0): the mod reads themes from `~/.claude/oxen-pet/themes` (found from the plugin's
   install path, since the mod reads no environment) or the absolute path the **Custom folder** setting
   gives, with no `..`, `~` or `$`. It reads only `<name>.theme.json` for a name of letters, digits, `-` and
   `_`, and never writes there. A theme from it goes through `readTheme` like any other.

## oxen-meter

`plugins/oxen-meter` is written for this repo, not forked. It measures the prompt cache from the token counts Claude
Code reports, and keeps metadata only: token counts, times, model and tool names, agent types. It never keeps a prompt,
an answer, a tool's input or output, a file path or a command. It makes no network request, starts no process, and
reads no environment variable: `$.http`, `$.process` and `$.env` appear nowhere in it, and the checks below print
nothing for it.

From `claude plugin validate plugins/oxen-meter --strict`:

```
hooks: session.start, turn.step, tool.call{tool=Bash}, tool.call{tool=Agent}, classic.SubagentStart,
       classic.SubagentStop, session.send, classic.SessionStart, classic.PostModelSwitch, session.compact,
       session.measure, turn.complete, session.end, command.run{command=meter}, ui.render{component=Pane}
calls: $.agent.list, $.clock.every, $.clock.now, $.command.register, $.fs.list, $.fs.read, $.fs.stat, $.fs.write,
       $.session.id, $.session.root, $.session.usage, $.store.get, $.store.set, $.ui.ask, $.ui.close,
       $.ui.invalidate, $.ui.open, $.ui.panes, $.ui.resolve, $.ui.toast
```

| Call | Used for |
| --- | --- |
| `turn.step` | Passes every model request on untouched (no model, effort or answer of its own), then records the response's four token counts, model, and the names of the tools it asked for |
| `tool.call` on Bash | Reads the command's text to label it a Codex handoff or an outcome (`git commit`, `gh pr create`); keeps the label, never the command |
| `tool.call` on Agent | Reads the result's agent id, type, model, token total and the 5m/1h split of its cache writes; never the prompt or the report |
| `session.compact` | Passes the compaction on untouched; records its trigger and sizes |
| `session.send` | The cold resume guard (below). Reads whom a message from Claude goes to, never its text |
| `classic.SessionStart`, `classic.PostModelSwitch` | Numbers Claude Code reports: how long a resumed session sat and whether its cache likely expired; the main thread's TTL |
| `session.measure` | The rate-limit windows' use, recorded when one moves |
| `$.ui.ask`, `$.ui.toast` | The guard's question and its warnings |
| `$.fs.write` | Only `<data folder>/sessions/<session id>.json`, `<data folder>/exports/oxen-meter-export-<date>[-<label>].json` and `<data folder>/state/salt.json`, through `hooks/dataPath.ts` (below) |
| `$.fs.read` | The meter's own `plugin.json` (its version), its session files in `<data folder>/sessions` (the CLI's Codex and Devin ones among them), and `state/salt.json` |
| `$.fs.list` | `<data folder>/sessions`, for `/meter report` and for emptying expired files |
| `$.fs.stat` | Where a path leads before each write |
| `$.session.id`, `$.session.root`, `$.session.usage` | The session file's name, the project (hashed by default), when the session started and what it cost |
| `$.store.*` | The salt for hashes (random, the user's own) until `state/salt.json` holds one, and when expired files were last emptied |
| `$.agent.list` | Which subagents are alive, for the pane |
| `$.command.register`, `$.ui.*` | `/meter` and its pane |

The data folder is the **Data folder** setting (absolute, no `..`, `~` or `$`), or `oxen-meter` in the `.claude`
folder the plugin is installed under. With neither, the meter writes nothing. `hooks/dataPath.ts` refuses any other
file name, a relative path or `..`; then, on disk, a symbolic link at the data folder, its `sessions`/`exports`
folder or the file, a folder or file that lands anywhere but where it is spelled, and a data folder whose parent is
not a folder. The data folder's own ancestors may be links (a `.claude` folder kept in a dotfiles repo).

There is no delete: `$.fs` has none. A session file past **Keep sessions (days)** is written over with
`{"v":1,"expired":true}` and stays as those few bytes.

`/meter export` writes the sessions of the last days to `exports/`, anonymized (`hooks/exportFile.ts`): session ids
hashed with the user's salt, agent and turn ids replaced by `a1`, `t1`, MCP tool names reduced to `mcp`, times counted
from the session's start, no folder. The user sends the file on by hand; the meter sends nothing.

`tools/meter/aggregate.mjs` builds the team report from exports. It is a developer tool a person runs by hand, outside
`plugins/oxen-meter`, so Claude Code never loads it. It reads the export files it is given and writes
`team-report.md` and `team-report.json` in `--out`. No network, no process.

One hook can hold anything back: `session.send`, the cold resume guard. With **Cold resume guard** set to `ask`, and
only for a message Claude sends (not a plugin's) to an agent whose cache likely went cold with at least **Cold resume
tokens** of context, it asks the user; on **Spawn a fresh agent** alone it answers `isDelivered: false`, and Claude
reads why as the SendMessage result. **Resume anyway**, no answer (`claude -p`), and an error in the guard all send
the message. `warn` (the default) and `off` never hold one back. Every other hook passes its event on, and a hook that
throws is skipped (fail-open). The checks above apply to it with `plugins/oxen-meter` in place of `plugins/oxen-pet`.
The first prints two lines of `hooks/codexLog.ts`, which reads Codex's own names `spawn_agent` and `thread_spawn` from
the CLI's input; the others print nothing.

### The oxen-meter CLI (`tools/meter/oxen-meter.mjs`)

Codex CLI and Devin CLI cannot load a Claude Code mod, so the meter reads their logs with a Node script a person runs
(`import`, `report`, `export`, `setup`), or a Codex or Devin hook runs (`hook codex`, `hook devin`). It is not part of the mod: Claude Code never loads it,
and it comes with this repo, or the clone Claude Code keeps of the marketplace (`~/.claude/plugins/marketplaces`). It
runs the mod's own modules (`lib/plugin.mjs`) for the parsing, analysis, files and guards.

- **Network, processes:** none. `node:fs`, `node:path`, `node:os`, `node:module`, `node:url` and
  `node:readline/promises` (setup's yes/no question) are all it imports, with its own `lib/` and, by `import()`, the
  mod's `plugins/oxen-meter/hooks/*.ts` and `node:sqlite` (for Devin).
- **Environment:** the home folder alone, through `os.homedir()`; every path under it can be named by a flag instead.
- **Reads:** `~/.claude/settings.json` (the oxen-meter options under `pluginConfigs`); Codex's
  `~/.codex/sessions/**/rollout-*.jsonl`, from where its last read stopped. Of each line it reads the head (time and
  type) and parses only the kinds it records: a thread's meta (its ids, parent, role and path; the working folder,
  hashed with the salt and dropped), the model and effort, each request's token counts, the rate limits, and a tool
  call's name, with the target of `spawn_agent`, `followup_task` and `send_message`. Prompts, answers, reasoning,
  tool input and output are never kept; a test fills every other field with a marker and checks no file holds it.
  Devin's `~/.local/share/devin/cli/sessions.db`, opened read-only: the `sessions` row (id, working folder, times) and,
  per node, only what SQLite's `json_extract` takes out of it (role, request id, model, times, label, token counts,
  subagent id and profile, the tool calls' names), so a message's text never reaches the CLI. The same marker test
  runs on a Devin database.
- **Writes:** through `tools/meter/lib/files.mjs`, which runs the mod's `dataPathError` with the CLI's kinds and
  `dataTargetError` on `lstat`/`realpath`: `sessions/codex-<session id>.json`, `exports/…`, `state/salt.json`, and its
  own `state/codex.json` and `state/devin.json` (where each file's read stopped, which Devin sessions it read),
  `state/codex.lock`, `state/devin.lock` (created exclusively, removed when the import ends, taken over after a
  minute), and `state/codex.guard.json`, `state/devin.guard.json` (the hooks' run times, and which idle spell a prompt
  was held back in).
  Nothing else in the data folder, and nothing through a symbolic link.
- **`setup codex --write`** writes `~/.codex/hooks.json`, after keeping the old one in `hooks.json.oxen-meter.bak`,
  and only after a yes on the terminal (or `--yes`); `setup devin --write` the `hooks` key of
  `~/.config/devin/config.json` alike, keeping every other key. Never `~/.claude/settings.json`, which Devin reads too. `lib/setup.mjs`'s `hookConfigError` holds it to those two files
  (and Devin's `~/.config/devin/config.json` with its backup): a plain file or none yet, in a folder that is there, not
  a symbolic link, landing where it is spelled. It keeps every hook the user has, drops its own older entries, and
  refuses a file that is not JSON. The backup gets the config's own file mode, so a `600` config is not copied out
  readable by others. Without `--write` it only prints. Codex runs a new hook only after the user trusts it
  in `/hooks`. The command it writes names this Node (`process.execPath`) and this CLI by absolute path.
- **`hook codex`** reads the event's JSON on stdin. On a prompt (`UserPromptSubmit`) it reads the last 512 KB of the
  main thread's rollout; on a follow-up to a subagent (`PreToolUse` on `followup_task` or `send_message`) the session
  file; at a turn's, a subagent's or a session's end it imports that one rollout. It prints one JSON object or nothing:
  a `systemMessage`, which Codex shows the user and never the model (checked: it is not in the rollout), or in `ask`
  mode `decision: block` on the user's own prompt, once per idle spell, which the user sends anyway with ↑ and Enter.
  It never prints `additionalContext`, `updatedInput` or a `permissionDecision`, so it adds nothing to the model's
  context and holds no tool call back. It exits 0 whatever happens, with everything but Node's built-ins loaded inside
  a `try` (`oxen-meter.mjs`), so a broken install prints nothing rather than a failed hook. Measured on Codex 0.160.1:
  about 70 to 180 ms a run, Node's start included.
- **`hook devin`** imports the session at a turn's or the session's end, and on a prompt in `ask` mode reads the
  session's metadata from Devin's database (read-only, as above) to hold the prompt back once per idle spell. Devin
  shows the user a held-back prompt's reason and no other hook message, so in `warn` mode it prints nothing. Devin's
  payload carries no transcript path; the session id is the database's. Measured on Devin 3000.11.3: about 150 to
  460 ms a run.
- **The salt** in `state/salt.json` is shared with the mod, so a session keeps one hashed id in every export.

```bash
# The CLI: no network, no process, no environment variable, no dynamic code
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|https?://|child_process|spawn\(|exec\(|process\.env|eval\(|new Function|node:(net|http|https|dgram|child_process|worker_threads)" \
  tools/meter --include='*.mjs' | grep -v '\.test\.mjs'
# expected: nothing

# Its imports
grep -rhoE "from '[^']+'|import\([^)]*\)" tools/meter/oxen-meter.mjs tools/meter/lib | sort -u
# expected: node:fs, node:module, node:os, node:path, node:readline/promises, node:url, its own lib, and import()
# of lib/cli.mjs, node:sqlite and the mod's hooks
```

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
