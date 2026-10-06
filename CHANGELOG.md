# Changelog

What each version of oxen-pet, and of oxen-meter, adds or changes for a user. Installed copies update
only when the version in the plugin's `.claude-plugin/plugin.json` changes; see README's Update section.

## 1.1.3 — 2026-10-06

- **The shield is off by default.** In bypass mode it asked about every destructive command, which is more than most
  people running bypass mode want. Turn **Shield** on in `/plugin configure oxen-pet@oxen-pet` to have it ask again;
  a setting you saved before keeps its value.

## oxen-meter 1.1.0 — 2026-10-06

Codex CLI and Devin CLI, measured beside Claude Code.

- **A command-line companion**, `tools/meter/oxen-meter.mjs` (Node 22.18+): `import` reads Codex's rollout files
  and Devin's session database into the meter's data folder, so `/meter report` and `/meter export` count them;
  `report` and `export` work without Claude Code too. Token counts, times and names only, as in Claude Code.
- **Hooks for Codex and Devin**, added by `setup codex|devin --write` (asks first, keeps a backup): before a prompt
  or a follow-up resumes a thread that sat past **Cold after** (60 minutes), Codex shows a warning; with the guard on
  `ask`, Codex and Devin hold the prompt back once. Each turn's end imports that thread.
- **The report by tool**: each tool's sessions and cost; for Codex and Devin, which have no fixed cache TTL, the
  **gap curve** (how often the cache held after 5 minutes to 6 hours idle); Devin's keepalive pings; compactions;
  and the **quota** each session used, from Claude Code's 5-hour and 7-day windows and Codex's weekly one.
- New settings: **Cached input weight** (what a cached OpenAI or SWE token weighs, 0.1) and **Cold after** (60).
- The team report adds tools, gap curves and quota per person; Codex now comes through each person's export
  instead of the collector's own machine.
- **A guide with a demo.** The meter's README is a guide now: a quick start for each tool, the pane row by row, the
  guard, the report, and a FAQ, with a GIF of the pane, the guard, the Codex and Devin hooks and the report, recorded
  from the meter's own modules.

## 1.1.2 — 2026-10-06

- **The HUD fits a narrow pane.** In a terminal narrower than the HUD window (64 columns), such as a
  pane split beside other agents, the HUD drew its window anyway and every edge wrapped. It now draws
  one bar per line with no window, bars shortened to fit (down to 4 cells), and cuts the text at the
  edge instead of wrapping it. Under 16 columns the HUD hides.

## oxen-meter 1.0.0 — 2026-10-06

A second plugin: the prompt cache, measured for a team. No pet, no band.

- **`/meter`** opens a pane with this session's cache hit rate, tokens read, written and uncached, the
  token equivalent, each role's TTL and how the meter knows it, cold resumes, and each live thread's cache
  state (warm, cooling, cold) with the minutes it has left.
- **The cold resume guard** warns (default), or asks to spawn a fresh agent instead, before Claude resumes
  an agent whose cache likely went cold with a large context; a thread that wakes on its own past its TTL
  gets a toast.
- **`/meter report [days]`** adds up past sessions; **`/meter export [days]`** writes them anonymized for
  `tools/meter/aggregate.mjs`, which builds a team report by person, agent type, model and week.
- Records token counts, times and names only, never prompts, code, paths or commands. Files go to
  `~/.claude/oxen-meter` through a guarded write.

## 1.1.1 — 2026-10-06

- **The HUD is one line by default.** HUD layout `row` is now the default, and it draws without a
  frame: label, bar, reading and one short detail per bar, the bars apart by a `│` in the frame's
  color. It takes one row under the prompt instead of five. Row bars are 10 cells, so the line fits
  about 90 columns; a narrower terminal gets the framed stacked HUD. Set HUD layout to `stacked` for
  the window with every detail.

## 1.1.0 — 2026-10-06

Luffy, a shield, a boss, a stats pane, and the HUD on the desktop.

- **Luffy is the default pet**, in five gears: Gear 1 while idle or reading (with meat), Gear 2 (pink,
  steaming) for Bash and running, Gear 3 (a giant fist) while editing, Gear 4 (red haki) when a call
  fails or the shield is up, and Gear 5 (white hair, the drums of liberation) when a turn ends. He uses a
  Den Den Mushi for the web, sends straw-hat minis out as subagents, and runs over the sea. Fan art; One
  Piece belongs to its owners. The slime, duck and alien stay built in.
- **Your own pets, kept through updates.** Themes live as `<name>.theme.json` in
  `~/.claude/oxen-pet/themes/` (or the **Custom folder** setting), outside the plugin's install folder.
  `/pet theme` lists the built-in pets and yours; `/pet theme <name>` switches at once, with no tokens,
  and keeps the choice. The **Theme** setting picks the pet a session starts with. A theme that does not
  read gives way to Luffy, with a toast.

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
- **Squash.** A theme's `squash`, from 0 to 1, sets how far the motions bend the sprite. Luffy uses
  0.15, so he hops and bobs without stretching out of shape; 1, the default, keeps every older pet as it
  was.
- **Forms.** A theme can give a mode a form of its own, `forms: { "<mode>": { sprite, palette, eyes, ... } }`:
  a new color, a new shape, or both, with every clip made from it. A pet can power up when it cheers,
  or turn red when a call fails. Themes kept by older versions read with no forms.
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
