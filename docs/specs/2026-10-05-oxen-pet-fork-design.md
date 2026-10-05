# oxen-pet: hardened fork of pixel-pet

Date: 2026-10-05
Status: approved (design approved in chat, "cook full")

## Goal

Run the pixel-pet Claude Code mod without trusting a third-party marketplace. Every line that runs
on the machine comes from a repo the owner controls and has read. Upstream changes arrive only by
an explicit, reviewed `git fetch upstream` + diff + cherry-pick.

Out of scope: new pets, HUD changes, new features (phases B/C later), CI.

## Repo and install

- Repo: `~/Projects/Freelancer/oxen-pet`, `origin` = `github.com/thanhnhoncntt/oxen-pet` (private).
- `upstream` = `github.com/Namenomeaning/pixel-pet`, fetch only (push URL `DISABLED`).
- Audited upstream commit: `02eb10af1788ee0514ed72ee3bf1cb7ad46b0764` (2026-10-03).
- Install: `claude plugin marketplace add thanhnhoncntt/oxen-pet` then
  `claude plugin install oxen-pet@oxen-pet`. Dev: `claude --plugin-dir ./plugins/oxen-pet`.

## Rename

`pixel-pet` → `oxen-pet` everywhere: marketplace name, plugin dir and name, `PluginState` key,
atom key, tool names (`mcp__oxen-pet__get_theme|preview_theme|set_theme`), skill dir and
`/oxen-pet:oxen-pet`, README, CLAUDE.md, `tools/preview`, tests. Owner/author/homepage point to the
fork. LICENSE keeps the original MIT copyright line and adds the fork's.

## Hardening

1. **Preview path guard.** `preview_theme` writes only when `path` is absolute, has no `..`
   segment, and its file name starts with `oxen-pet-preview` and ends with `.html`. Otherwise it
   denies with a message naming the rule. It also refuses a symbolic link at the path and a missing
   folder (`previewTargetError`, from `$.fs.stat`). The checks are pure functions
   in its own module with tests. Effect: a prompt-injected Claude cannot use the tool to
   overwrite dotfiles or source code.
2. **Remove `tools/demo/`** (spawns Chrome and ffmpeg) and `docs/images/` (README gifs).
3. **`targets` setting defaults to `false`**: the status line does not name files, patterns,
   commands, hosts, or queries unless the user turns it on. `readSettings` fallback matches.
4. **`SECURITY-AUDIT.md`**: audited commit, the mod's capability list (from
   `claude plugin validate`), grep results for network/process/env access, and the procedure for
   pulling upstream changes.

## Verification

- `claude plugin validate . --strict`, `claude plugin validate plugins/oxen-pet --strict`,
  `claude plugin test plugins/oxen-pet` all pass.
- Type check with `tsc -p plugins/oxen-pet` after one `--plugin-dir` load.
- `node tools/preview/build.mjs` runs.
- `grep -ri pixel-pet` finds only attribution/provenance lines.
- Private GitHub repo created and pushed; plugin installed from it in a real session.
