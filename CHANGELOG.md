# Changelog

What each version of oxen-pet adds or changes for a user. Installed copies update only when the
version in `plugins/oxen-pet/.claude-plugin/plugin.json` changes; see README's Update section.

## 1.1.0 — 2026-10-06

A shield, a boss, a stats pane, and the HUD on the desktop.

- **Shield.** Before a destructive Bash command runs *unasked* (bypass or auto mode, or an allow
  rule), the pet raises a shield and asks **Block it** / **Run it**. The question names what the
  command does and how many files each `rm` target holds (`build: 132 files`). It covers recursive
  `rm`, `git push --force`, `git reset --hard`, `git clean -f`, `git checkout -- .`, `git restore`,
  `git branch -D`, `git stash drop`/`clear`, `DROP`/`TRUNCATE TABLE`, `terraform destroy`,
  `kubectl delete`, `docker system prune`, `find -delete` and `dd`/`mkfs`. With no one to answer
  (`claude -p`), the command is blocked. When Claude Code asks anyway, the shield only adds what the
  command deletes to its dialog. New setting **Shield** (`guard`, on by default).
- **Bug boss.** A failed test run (`npm test`, `pytest`, `go test`, `cargo test`, and other common
  runners) brings a bug boss into the band, with a pip for each failed run. The next run that passes
  defeats it: it flashes, puffs away, and the pet cheers. A run piped into another command
  (`npm test | tail`) reads as passed. New setting **Bug boss** (`boss`, on by default).
- **`/pet` pane.** Opens or closes a pane with the session's length and turns, tool calls by motion,
  files read and edited (names only with **Name files and commands** on), subagents, test runs and
  bosses beaten, the shield's answers, and MP's burn rate per hour.
- **Low-context alert.** As HP drops under 20%, a toast suggests `/compact` or a hand-off, and the
  pet says so in red, once until HP climbs back to 30%. `⚠ HP` and `/compact` now show under 20%
  (was 10%).
- **HUD layout.** A new setting, **HUD layout** (`hudLayout`): `row` lays HP, MP and ST side by
  side in one line, each bar shorter, with its reading and one short detail (the cache for HP, the
  time to reset for MP and ST) or its warning. A terminal too narrow for the row gets the stacked
  HUD. `stacked` stays the default.
- **Desktop.** The Desktop app's Code tab now shows the HUD under the pet, each bar drawn as SVG,
  and a theme's scene, as one SVG band.
- The preview page shows the new `guard` motion and the boss fight. Themes can set `props.guard`,
  `lines.guard` and `lineColors.guard`.

## 1.0.2 — 2026-10-05

HUD readings that say how much is left, not only how much is used.

- **Even-pace mark on MP and ST.** A light column on each bar marks where it would be if the limit
  were used evenly through its window (5 hours for MP, 7 days for ST). The detail says how far ahead
  of that pace the reading is (`38% spare`), how far behind (`5% over`), or `on pace`.
- **MP runs-out forecast.** When MP's average burn so far in its window would empty it before the
  reset, MP reads `empty ~1h20m` in red in place of the pace detail. No forecast in a window's first
  15 minutes, while the rate is still noise.
- **Prompt cache timer beside HP.** `cache 52m` counts down how long the prompt cache stays warm
  after the main thread's last turn, then reads `cache cold`; a subagent's turn does not warm it.
  The API does not report the cache's TTL to a mod, so a new setting, **Cache timer** (`cacheTtl`:
  `1h` default, `5m`, or `off`), sets it. The timer starts empty after a reload or `/clear`, and does
  not know that `/model` drops the cache.
- The HUD window is 64 columns wide (was 54), to fit the new details.
- The preview page shows a third HUD sample, "Burning fast".

## 1.0.1 — 2026-10-05

- `preview_theme` refuses a symbolic link or a missing folder at the preview path.
- Fix the `claude plugin configure` example in the skill.

## 1.0.0 — 2026-10-05

The hardened fork of pixel-pet; see `SECURITY-AUDIT.md`.

- Renamed pixel-pet to oxen-pet, installed from this repo's own marketplace.
- `preview_theme` writes only `oxen-pet-preview*.html` files.
- The status line hides tool targets (files, commands, hosts) unless **Name files and commands** is on.
- Dropped the demo tooling.
