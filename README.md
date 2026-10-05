# oxen-pet

A pixel pet for the Claude Code terminal. It acts out what Claude is doing, and a game-style HUD
below the prompt keeps your context and rate limits in view.

oxen-pet is a hardened fork of [pixel-pet](https://github.com/Namenomeaning/pixel-pet) by
halluqinate (MIT). It is installed from this private repo only, so nothing runs that was not read
here first. What was audited and what changed: [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).

## Install

You need Claude Code v2.1.287 or later (`claude --version`) and read access to this repo.

```bash
claude plugin marketplace add thanhnhoncntt/oxen-pet
claude plugin install oxen-pet@oxen-pet
```

Start a new session, or run `/reload-plugins` in an open one. The slime appears above the prompt.

To uninstall, run `claude plugin uninstall oxen-pet@oxen-pet`.

## What the pet does

| When | The pet |
| --- | --- |
| Claude is idle | Breathes, blinks, and looks around. Falls asleep after the **Sleep after** time, a minute by default. |
| A turn starts | Jumps |
| A tool call ends | Runs back and forth for 4 seconds |
| Claude thinks longer | Looks around, with `?` and dots |
| `Read` | Reads a book |
| `Grep`, `Glob` | Sweeps a magnifier |
| `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `TodoWrite` | Writes with a pen |
| `Bash`, and any tool not listed | Types in a small terminal |
| `WebFetch`, `WebSearch` | Spins a globe |
| A subagent starts | Smiles. A mini joins the trail behind the pet until that subagent finishes. |
| A tool call fails | `x x` eyes and a sweat drop |
| A turn ends | Cheers |

With **Name files and commands** on, the status line also names the target, such as
`reading app.ts` or `$ npm test`. It is off by default.

## The HUD

A pixel window below the prompt holds up to three bars:

- **♥ HP** is the context window left. Yellow at 50 % or less, red at 25 % or less, `/compact` under 10 %.
- **✦ MP** is the 5-hour rate limit left, with the time to its reset.
- **◆ ST** is the 7-day rate limit left, with the time to its reset.

MP and ST turn red under 15 %, and show on Pro and Max plans once a response has reported its limit.

## Make it yours

Ask Claude in any session, or run `/oxen-pet:oxen-pet`: change the pet, its props, minis, status
lines, HUD, or scene. Claude writes a preview page (`/tmp/oxen-pet-preview-*.html`) first, and sets
the theme only when you approve. To undo, ask for the slime back. The theme format is in
[`FORMAT.md`](plugins/oxen-pet/skills/oxen-pet/FORMAT.md); [`alien.json`](plugins/oxen-pet/assets/alien.json)
uses every field.

## Settings

In a session, run `/plugin configure oxen-pet@oxen-pet`.

| Setting | Default | What it does |
| --- | --- | --- |
| Speed | `normal` | How quickly the pet runs and animates: `slow`, `normal`, or `fast`. |
| Sleep after (seconds) | `60` | Idle time before the pet falls asleep. `0` keeps it awake. |
| HUD | on | The HP, MP, and ST bars below the prompt. |
| Status line | on | The text beside the pet. |
| Name files and commands | **off** | The status line names the file, pattern, command, host, or search query a tool works on. |
| Subagent minis | on | A mini behind the pet for each running subagent. |

From a shell:

```bash
echo '{"speed": "fast", "targets": "true"}' | claude plugin configure oxen-pet@oxen-pet --values-stdin
```

## Update

```bash
claude plugin marketplace update oxen-pet
claude plugin update oxen-pet@oxen-pet
```

Installed copies update only when `version` in `plugins/oxen-pet/.claude-plugin/plugin.json`
changes. Upstream changes come in only by review: see "Taking an upstream change" in
[`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).

## Where it shows

The pet draws with colored text cells, so it works in any terminal with 24-bit color. The Desktop
app's Code tab shows it as SVG. The VS Code chat panel, `claude -p`, and cloud sessions don't show
it. The HUD shows only in the terminal.

## Develop

```text
.claude-plugin/marketplace.json   the repo is a marketplace with one plugin
plugins/oxen-pet/                 the plugin: a Claude Code mod
  .claude-plugin/plugin.json      name, version, and settings
  hooks/hooks.json                points Claude Code at register.tsx
  hooks/register.tsx              wires Claude Code's events to the modules, and serves the tools
  hooks/anim.ts                   what the pet does on each tick
  hooks/pixels.ts                 draws a frame
  hooks/theme.ts                  reads a theme and makes its frames
  hooks/scene.ts                  lays out and draws a theme's scene
  hooks/preview.ts                writes the preview page
  hooks/previewPath.ts            where preview_theme may write
  hooks/status.ts                 the status line
  hooks/hud.ts                    the HP, MP, and ST bars
  hooks/minis.ts                  a mini per subagent
  hooks/settings.ts               reads the settings
  hooks/*.test.ts                 the tests, one file per module
  types/index.d.ts                the mod's state
  assets/                         slime (default), duck, alien themes
  skills/oxen-pet/                the skill that draws a pet with you, and the pet format
tools/preview/build.mjs           writes the preview of a theme file
docs/                             design spec and plan of the fork
```

Load your working copy for one session with `claude --plugin-dir ./plugins/oxen-pet`. Before a
push, run:

```bash
claude plugin validate . --strict
claude plugin validate plugins/oxen-pet --strict
claude plugin test plugins/oxen-pet
```

After one `--plugin-dir` session, `npx -p typescript tsc -p plugins/oxen-pet` type-checks the mod.
`node tools/preview/build.mjs [theme file]` (Node 22.18+) writes `tools/preview/preview.html`.
Contributor rules are in [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE). Original work © 2026 halluqinate; fork changes © 2026 NhonNguyen.
