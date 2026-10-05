<div align="center">

# oxen-pet

### A pixel pet and an RPG-style usage HUD for Claude Code

A little slime lives above your Claude Code prompt and acts out every tool call. Below the prompt, a
game HUD shows your **context window**, **5-hour and weekly rate limits**, and **prompt cache**,
so you always know how much is left.

[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757?style=flat-square)](https://code.claude.com/docs/en/plugins/mods/interface)
[![Version](https://img.shields.io/badge/version-1.0.2-5aa9ff?style=flat-square)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-4ade80?style=flat-square)](LICENSE)
[![No network](https://img.shields.io/badge/network-none-a78bfa?style=flat-square)](SECURITY-AUDIT.md)
[![Audited fork](https://img.shields.io/badge/fork-audited-fbbf24?style=flat-square)](SECURITY-AUDIT.md)

<img src="docs/images/demo.gif" alt="oxen-pet in Claude Code: a pixel slime reads, searches, fetches, edits and runs tests while the HP, MP and ST bars below the prompt track context, rate limits and prompt cache" width="860">

[Install](#install) · [The pet](#what-the-pet-does) · [The HUD](#the-hud) · [Make it yours](#make-it-yours) · [Settings](#settings) · [Security](#privacy-and-security) · [FAQ](#faq)

</div>

---

## Why oxen-pet

- 🎮 **See what Claude is doing at a glance.** The pet reads a book on `Read`, sweeps a magnifier on
  `Grep`, types on `Bash`, spins a globe on `WebFetch`, and cheers when a turn ends.
- 📊 **Never run out of usage by surprise.** HP, MP and ST bars track the context window and the
  5-hour and 7-day rate limits of a Pro or Max plan, with the time to each reset.
- 🧭 **Know whether you can keep going.** A pace mark on each limit bar shows where you would be at an
  even burn, and MP warns `empty ~1h20m` before the 5-hour limit runs out.
- 🔥 **Keep the prompt cache warm.** A countdown beside HP shows how long the cache lasts after the
  last turn, so you know when the next message gets more expensive.
- 🎨 **Make your own pet.** Ask Claude for a cat, a duck or an alien with its own props, scene, status
  lines and HUD colors. Claude shows you a preview page before anything changes.
- 🔒 **Safe to run.** No network, no processes, no environment variables, no tokens spent. It is a
  hardened, audited fork of [pixel-pet](https://github.com/Namenomeaning/pixel-pet).

## Install

You need Claude Code v2.1.287 or later (`claude --version`).

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

The pet's face follows the HUD too: it looks worried as the context fills up, and tired when a rate
limit runs low. With **Name files and commands** on, the status line also names the target, such as
`reading app.ts` or `$ npm test`. It is off by default.

## The HUD

<img src="docs/images/hud.png" alt="The oxen-pet HUD: HP 78% with the prompt cache warm for an hour, MP 88% with 15% to spare, ST 81% with 38% to spare" width="594">

A pixel window below the prompt holds up to three bars. Each shows what is **left**, not what is used.

| Bar | Tracks | Beside the reading |
| --- | --- | --- |
| **♥ HP** | The context window left | `cache 52m`: how long the prompt cache stays warm after the last turn, then `cache cold`. `/compact` under 10 %. |
| **✦ MP** | The 5-hour rate limit left | The time to its reset, and how far ahead of an even pace you are (`15% spare`) or behind (`5% over`). `empty ~1h20m` in red when the burn so far would empty it before the reset. |
| **◆ ST** | The 7-day (weekly) rate limit left | The time to its reset, and `spare` or `over` as for MP. |

**Reading the pace mark.** The light column on the MP and ST bars is where the bar would be if the
limit were used evenly through its window. Fill to the right of the mark means you are using less
than the pace and can push harder. Fill to the left means you are burning faster than the window
allows.

HP turns yellow at 50 % or less and red at 25 % or less. MP and ST turn red under 15 %, and show on
Pro and Max plans once a response has reported its limit.

## Make it yours

Ask Claude in any session, or run `/oxen-pet:oxen-pet`:

> *"Make my pet an orange cat with a fish instead of the book, and put it on the moon."*

Claude can change the pet, its props, minis, status lines, HUD colors and labels, or add a scene with
ground, sky and obstacles the pet leaps over. It writes a preview page (`/tmp/oxen-pet-preview-*.html`)
with every motion and face first, and sets the theme only when you approve. To undo, ask for the
slime back.

Two more pets ship with the plugin, [`duck.json`](plugins/oxen-pet/assets/duck.json) and
[`alien.json`](plugins/oxen-pet/assets/alien.json) (which uses every field). The theme format is in
[`FORMAT.md`](plugins/oxen-pet/skills/oxen-pet/FORMAT.md).

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
| Cache timer | `1h` | How long the HUD counts the prompt cache warm after a turn: `1h`, `5m`, or `off`. |

From a shell:

```bash
echo '{"speed": "fast", "targets": "true"}' | claude plugin configure oxen-pet@oxen-pet --values-stdin
```

Settings apply after Claude Code restarts.

## Privacy and security

oxen-pet runs inside your Claude Code session, so it is built to do as little as possible:

- **No network requests, no processes, no environment variables.** The shipped code is checked for
  each of these before every push; the commands are in [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).
- **No tokens spent.** The HUD reads the same usage figures as the status line. It never calls the model.
- **Nothing on screen you did not choose.** File names and commands stay out of the status line
  unless you turn on **Name files and commands**, so a shared screen or a recording shows none.
- **One guarded file write.** The theme preview writes only `oxen-pet-preview*.html` files, and
  refuses `..` paths and symbolic links.
- **No self-updating marketplace.** Upstream changes come in only by a full read of the diff and a
  cherry-pick.

## FAQ

<details>
<summary><b>How do I see my Claude Code rate limits and usage in the terminal?</b></summary>

Install oxen-pet. The MP bar is the 5-hour limit and the ST bar the weekly (7-day) limit, each with the
percentage left and the time to its reset. They appear on Pro and Max plans after the first response
of a session.
</details>

<details>
<summary><b>What does "38% spare" mean?</b></summary>

You have 38 points more of the limit left than you would at an even pace. For example, three days
before a weekly reset an even pace leaves about 43 %; at 81 % left you are 38 points ahead.
</details>

<details>
<summary><b>What is "cache cold", and why does it matter?</b></summary>

Claude Code caches the conversation so each new message re-reads it cheaply. The cache lapses some
time after the last turn: an hour or five minutes, depending on your setup. Set **Cache timer** to
match. Once it reads `cache cold`, the next message rebuilds the cache and costs more of your limit.
</details>

<details>
<summary><b>Where does it show?</b></summary>

In any terminal with 24-bit color. The Desktop app's Code tab shows the pet, without the HUD. The VS
Code chat panel, `claude -p`, and cloud sessions do not show it.
</details>

<details>
<summary><b>How is it different from pixel-pet?</b></summary>

oxen-pet is a fork of [pixel-pet](https://github.com/Namenomeaning/pixel-pet) with a security audit
and fixes (a guarded preview write, file names hidden by default), plus the pace marks, the MP
forecast and the prompt cache timer. What each version changed is in [`CHANGELOG.md`](CHANGELOG.md).
</details>

## Update

```bash
claude plugin marketplace update oxen-pet
claude plugin update oxen-pet@oxen-pet
```

Installed copies update only when `version` in `plugins/oxen-pet/.claude-plugin/plugin.json`
changes. What each version changed is in [`CHANGELOG.md`](CHANGELOG.md).

## Develop

<details>
<summary>Layout, commands, and the demo recorder</summary>

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
  hooks/hud.ts                    the HP, MP, and ST bars, the pace marks, and the cache timer
  hooks/minis.ts                  a mini per subagent
  hooks/settings.ts               reads the settings
  hooks/*.test.ts                 the tests, one file per module
  types/index.d.ts                the mod's state
  assets/                         slime (default), duck, alien themes
  skills/oxen-pet/                the skill that draws a pet with you, and the pet format
tools/preview/build.mjs           writes the preview of a theme file
tools/demo/record.mjs             records docs/images/demo.gif and hud.png (developer tool, never shipped)
docs/                             design spec and plan of the fork, and the README images
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
`node tools/demo/record.mjs` (Node 22.18+, Google Chrome and ffmpeg) records the README's GIF from the
mod's own modules: no screen capture and no tokens. Contributor rules are in [`CLAUDE.md`](CLAUDE.md).
</details>

## License

[MIT](LICENSE). Original work © 2026 halluqinate ([pixel-pet](https://github.com/Namenomeaning/pixel-pet));
fork changes © 2026 NhonNguyen.

<sub>Keywords: Claude Code plugin, Claude Code mod, Claude Code statusline, Claude Code HUD, usage tracker,
rate limit monitor, context window, prompt cache, terminal pet, pixel art, Anthropic Claude.</sub>
