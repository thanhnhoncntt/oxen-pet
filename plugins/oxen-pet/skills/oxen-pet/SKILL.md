---
name: oxen-pet
description: Customize the oxen-pet theme. Draw, recolor, or edit the mascot, change its props (the thinking question mark, the web globe, the book, the terminal), minis, status line text and colors, the HUD's look, and the scene (a background, ground, and obstacles the pet jumps). Also sets speed, sleep, HUD on or off, status line on or off, naming files, minis, the shield, and the bug boss, loads or shares a theme file, and brings the slime back.
---

# Pixel pet

One entry point to change anything the mod draws: the pet, its props, its minis, the status line, the HUD, the scene, and the settings. A request can touch any subset. All of it but the settings lives in one theme: a JSON object with the pet's sprite and everything else it changes. Read [FORMAT.md](FORMAT.md) before you change a theme.

Three tools do the work. Their full names end in `__get_theme`, `__preview_theme`, and `__set_theme`; from the marketplace they are `mcp__oxen-pet__get_theme`, `mcp__oxen-pet__preview_theme`, and `mcp__oxen-pet__set_theme`. When they are not listed, follow [Troubleshooting](#troubleshooting) and stop.

- `get_theme` takes no input and returns the theme on screen: the one `set_theme` kept, or the slime's.
- `preview_theme` takes `theme` and `path`, and writes an HTML page of the theme. What is on screen stays as it is. `path` must be absolute, have no `..`, and name a file that starts with `oxen-pet-preview` and ends with `.html`; any other path is refused.
- `set_theme` takes `theme`, `null` for the slime, or no `theme` for the last theme `preview_theme` drew in this session. It replaces the whole theme on screen, at once, and keeps it for later sessions.

Everything below is a default that makes a good pet. The user's idea wins: a pet with no eyes, a tall thin one, a wild palette. The tools draw nearly anything and return notes on what they repaired.

## 1. Find out what they want

Name the parts the request touches:

| The user wants | Part | Reference |
| --- | --- | --- |
| A new mascot, a recolor, new eyes or cheeks | the sprite, `palette`, `eyes`, `cheeks` | [Fields](FORMAT.md#theme-format), [Size](FORMAT.md#size), [Eyes](FORMAT.md#eyes) |
| An effect in a mode: the book, the globe, the terminal, the question mark | `props` | [Props](FORMAT.md#props), [Modes](FORMAT.md#modes) |
| What a running subagent looks like | `mini`, `miniSprite` | [Minis](FORMAT.md#minis) |
| The words beside the pet, or their color | `lines`, `lineColors` | [Status lines](FORMAT.md#status-lines) |
| The HUD's frame, labels, colors, fills, or a hidden bar | `hud` | [HUD](FORMAT.md#hud) |
| A background, ground, or obstacles the pet jumps | `scene` | [Scene](FORMAT.md#scene) |
| Speed, sleep, the HUD or status line on or off, naming files, minis, the shield or the boss on or off | settings, not the theme | [Settings](#settings) |

A whole style ("a pirate pet") touches the sprite, the lines, the HUD, and the scene at once. Change each and say what you changed.

When the request does not settle the parts, ask one question:

> Recolor or edit your pet, draw a new one (describe it), change its props, minis, text, HUD, or scene, load a theme file (give the path), change a setting, or get the slime back?

When they ask for a new pet without a description, ask what it is and its main color, in that one question.

## 2. Get the starting theme

`set_theme` replaces the whole theme, so every change starts from a complete one.

- A new pet: no starting theme. Go to step 3.
- A theme file the user gives: read it and use its object as `theme`.
- Anything else: call `get_theme` and use the theme it returns.

A request for one part keeps every other field of the starting theme as it is.

## 3. Make the changes

**Recolor the slime.** When the starting pet is the slime, keep its `sprite`, `eyes`, `cheeks`, and `outline`. Replace each `palette` color with one of the new hue, in the same order from light (`h`) to dark (`a`). Recolor `mini` to match. When the new hue is near pink, change `cheekColor` so the cheeks show.

**A new pet.** Draw from the description. Do not ask about size or format.

1. Pick a palette ramp lit from the top left: outline (darkest), shadow, base, light, highlight, plus one color per feature, such as a beak.
2. Draw the silhouette within the scale-1 size in [FORMAT.md](FORMAT.md#size). Make it compact with a wide flat bottom row. The pet may face the viewer or one side.
3. Spend pixels on what makes the pet itself: ears, a beak, a tail. Make each at least 2 pixels thick, so a squash keeps it ([why](FORMAT.md#how-the-pet-moves)).
4. Leave a flat patch of base color for each eye and set `eyes`, using the box geometry in [FORMAT.md](FORMAT.md#eyes).
5. Add `cheeks` a pixel below or beside the eye boxes when they suit the pet.
6. Set `mini` from the pet's light, base, and outline colors.

Example, a front-facing cat ([`assets/duck.json`](../../assets/duck.json) is a side-facing one):

```json
{
  "name": "cat",
  "sprite": [
    ".aa.......aa.",
    ".apa.....apa.",
    ".aoaaaaaaaoa.",
    "aoooooooooooa",
    "aoooooooooooa",
    "aoooooooooooa",
    "aoooooooooooa",
    "aoooollpllooa",
    "asssssssssssa",
    ".aaaaaaaaaaa."
  ],
  "palette": { "a": "#4a2f1d", "o": "#f0903c", "s": "#c8681f", "l": "#ffc27a", "p": "#ff7a90" },
  "outline": "a",
  "eyes": [[3, 5], [7, 5]],
  "cheeks": [[2, 7], [10, 7]],
  "mini": { "top": "#ffc27a", "body": "#f0903c", "edge": "#4a2f1d" }
}
```

**Props.** Find the mode in [Modes](FORMAT.md#modes) from the user's words: the question mark and dots are `think`, the book is `read`, the globe is `web`. Ask what should appear when the user has not said. Draw each prop in the pet's palette, and add a palette entry for every color it needs.

**Minis.** Recolor the drop with `mini`, or draw a `miniSprite` as a small relative of the pet, in its palette.

**Status lines.** Write each line in the pet's voice, in the tone of the mod's own, listed in [`hooks/status.ts`](../../hooks/status.ts). Change only the modes the user names. Give each mode a line without `{}` ([why](FORMAT.md#status-lines)).

**The HUD.** Pick a `frame` color and each bar's label, color, and fill. Pick mid tones. Keep a label to 6 characters.

**The scene.** Set it in the place the pet lives: grass and rocks, a moon with craters, a pond. [`assets/alien.json`](../../assets/alien.json) has a moon scene.

1. Draw a `ground` tile 16 wide and 2 high, with a little texture so the repeat is not flat.
2. Draw 2 or 3 `obstacles` with different silhouettes, 3 to 6 pixels high and narrow, so each reads as a thing to jump.
3. Add a few small `decor` drawings: on the ground (a tuft, a flower) or raised into the sky with clear rows below (a cloud, a star). Raised decor drifts across the sky.
4. Draw a `sky` that suits the place, such as a sun, a moon, or a planet. It stays put near the top right, and the drifting decor passes in front of it.
5. Leave the rest of the sky clear. A filled background turns the band into a block of color over the user's terminal.
6. Add every scene color to `palette`, in mid tones.

**The slime back.** Call `set_theme` with `theme` set to `null`. Tell the user the slime is back. Stop.

## 4. Preview it

Preview every theme you drew or changed: the user has not seen it yet. A ready-made theme the user named as is (a theme file, a repo's `assets/alien.json`, the slime back) is already chosen: go to [step 6](#6-put-it-on-screen) and pass it as `theme`. Skip the preview of your own changes only when the user asks.

Call `preview_theme` with `theme` and an absolute `path` in the temp folder, such as `/tmp/oxen-pet-preview-cat.html`.

- A theme with no sprite is refused. Add a sprite and call again.
- Any other theme draws. The result gives the resting frame (`@` is a pupil, `*` a cheek) and notes.
- Read the resting frame. The pupils sit where the face should be, each feature reads, and no pixel strays.
- Read the notes against [FORMAT.md](FORMAT.md#notes). Fix a note that names something the user did not mean, such as a color drawn clear. Leave the rest as drawn.

Open the page: `open <path>` on macOS, `xdg-open <path>` on Linux, `start <path>` on Windows. Tell the user the page shows each mode in motion with its props, the pet running through its scene, every face, each mode's status lines in their colors, the HUD in two sample states, and the frames, and that its button shows the pet on a light terminal.

When the page cannot open here (an SSH session or a server with no display), show the resting frame in a code block, list the notes in chat, and give the path with a copy command for the user's own machine, such as `scp <this host>:<path> .`.

End your turn by asking the user to approve the theme or say what to change. Their reply starts the next step: changes go to step 5, approval to step 6.

## 5. Revise

Apply each request, such as bigger ears or a darker color, to the theme. Call `preview_theme` again with the same `path`, and ask them to reload the page. Change only what they asked for. Redraw from scratch only when they ask.

## 6. Put it on screen

For an approved preview, call `set_theme` with `theme` left out, so it sets the last preview exactly as the user saw it. For a ready-made theme, pass it as `theme`, then say what changed on screen. Offer to save it as `<name>.theme.json` in the current directory, so it can be edited and shared later. Tell the user to ask for the slime back to undo.

## Settings

Settings are the user's choices, kept apart from the theme. They need no preview. In a session, the user runs `/plugin configure oxen-pet@oxen-pet`. From a shell, pipe a JSON object of strings:

```bash
echo '{"speed": "fast", "hud": "false"}' | claude plugin configure oxen-pet@oxen-pet --values-stdin
```

Options left out keep their values. The change applies after Claude Code restarts, so tell the user to start a new session. `claude plugin configure oxen-pet@oxen-pet --json` lists each setting's type, default, and limits.

| Key | Values | What it sets |
| --- | --- | --- |
| `speed` | `slow`, `normal`, `fast` | How quickly the pet runs and animates. |
| `sleepAfter` | seconds, 0 to 3600 | Idle time before the pet sleeps. `0` keeps it awake. |
| `hud` | `true`, `false` | The HP, MP, and ST bars below the prompt. |
| `statusLine` | `true`, `false` | The text beside the pet. |
| `targets` | `true`, `false` | The status line names the file, pattern, command, host, or search query. `false` suits a shared screen. |
| `minis` | `true`, `false` | A mini behind the pet for each running subagent. |
| `cacheTtl` | `1h`, `5m`, `off` | How long the HUD counts the prompt cache warm after a turn. |
| `hudLayout` | `stacked`, `row` | The HUD's bars one per line, or side by side in one line with a short detail each. |
| `guard` | `true`, `false` | The shield: ask before a destructive Bash command runs unasked. With no one to answer, it is blocked. |
| `boss` | `true`, `false` | A failed test run brings a bug boss into the band. |

## Troubleshooting

| What happens | Why, and what to tell the user |
| --- | --- |
| The tools are not listed (`get_theme`, `preview_theme`, `set_theme`) | oxen-pet is not installed, or the session started before it loaded. Install it with `claude plugin install oxen-pet@oxen-pet`, then tell the user to run `/reload-plugins` or start a new session. After `/reload-plugins`, the tools appear from the next prompt on. Continue once they are listed. Preview and set through the tools only: the repo's `tools/preview/build.mjs` and a hand-written store both bypass the mod. |
| The tools are still missing after an install | Claude Code is older than v2.1.287, which mods need. Check with `claude --version` and update Claude Code. |
| After install: "N userConfig options not yet set" | Every setting has a default. Nothing to do. |
| An update changed nothing | An installed copy updates only when the plugin's version changes. Run `claude plugin marketplace update oxen-pet`, then `claude plugin update oxen-pet@oxen-pet`, and start a new session. |
| The pet does not show | The VS Code chat panel, `claude -p`, and cloud sessions do not draw it. It shows in a terminal and in the Desktop app's Code tab. The HUD shows only in a terminal. |
| A setting changed nothing | Settings apply after a restart. Start a new session. |
| A toast says "your theme no longer reads", and the slime is back | The kept theme has no sprite left. Load the user's theme file again, or draw it again. |
| The preview page does not open | Show the resting frame and the notes in chat, and give the user the path to open in a browser. |
