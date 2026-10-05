oxen-pet is a Claude Code mod: a pixel pet above the prompt and a HUD below it. The repo is a marketplace with one plugin, `plugins/oxen-pet`. `README.md` holds the layout, the commands, and the release step. This file holds the rules a change must keep.

## Terms

Use these words in code, comments, docs, and UI, and no others for the same thing.

- **pet**: what the mod draws. **slime**: the default pet, and its theme. **theme**: one JSON object with a pet's sprite and everything else it changes (props, minis, status lines, HUD, scene), in the format `skills/oxen-pet/FORMAT.md` documents; a theme file holds one. **sprite**: the one still drawing in a theme. **clip**: a loop of frames, one of stand, run, jump, think, cheer. **frame**: one picture of a clip, made from the sprite. **body**: a pet made ready to draw by `animate`, with every clip.
- **mode**: what the pet is acting out (`idle`, `read`, `bash`, ...). One mode has one set of status lines and one line color. User-facing text calls a mode's animation a **motion**. **face**: one eye expression, one of the 18 in `pixels.ts`.
- **status line**: the text beside the pet. **band**: the `AbovePrompt` area the pet and status line sit in. **target**: what a tool call works on (a file, pattern, command, host, or search query), which the status line names.
- **mini**: the small drop for one running subagent, in the pet's `mini` colors. **trail**: the minis behind the pet.
- **HUD**: the window below the prompt with up to three bars. **HP** is the context window left, **MP** the 5-hour rate limit left, **ST** the 7-day rate limit left.
- **reading**: the bold number after a bar. **detail**: the grey text after the reading.
- **settings**: the user's choices from the plugin's `userConfig`, read by `settings.ts`. **pace**: the speed setting as a multiplier.
- **prop**: what the pet holds beside it in a mode (a book, a terminal), the mod's or the pet's own; `props.think` also stands in for the question mark. **look**: what a theme changes beyond the pet's drawing: status lines, line colors, and the HUD.
- **scene**: a theme's background for the band, from `scene.ts`: a **ground** row below the pet, a **sky** drawing that stays put near the top right, **obstacles** standing on the ground, and **decor** behind the pet; raised decor drifts. **leap**: a running pet's jump over an obstacle, the jump clip slowed while it travels.
- **preview**: the HTML page with every motion, face, scene, status line, HUD look, and frame of a pet, from `preview.ts`. There is one; `preview_theme` and `tools/preview/build.mjs` both write it.
- **activity**: what the session is doing, as the hooks saw it; `anim.ts` turns it into the pet's next mode.

## Before a change is done

- Run the three commands in README's Develop section. All must pass.
- Type-check with `tsc -p plugins/oxen-pet`.
- Run `node tools/preview/build.mjs` and open the preview. A JS error on the page fails the change.
- Bump `version` in `plugins/oxen-pet/.claude-plugin/plugin.json` when users should get the change.

## Traps

- The mod validator lets `$` pass only into top-level function declarations, not into arrow functions or nested functions.
- The poses in `theme.ts` and its `roundHalfEven` fix the slime's frames pixel for pixel; `theme.test.ts` pins them. A change to a pose changes every pet.
- `readTheme` refuses only a theme with no sprite. Everything else draws, repaired where needed, with a note saying what changed. Keep it that way: people and agents draw odd pets on purpose.
- A field added to the theme format goes in `readTheme`, in `skills/oxen-pet/FORMAT.md`, in `assets/alien.json`, and in a test. A theme kept by an older version must still read.
- Every color must read on a dark terminal and on a light one. Pick mid tones; avoid near-white and near-black text.
- Pass a string `key` to elements. A number fails the type check.
- `tools/demo/record.mjs` lays out the band and the HUD as `register.tsx` does, with copies of its layout constants. A layout change in `register.tsx` goes in both.
- `register.tsx` is the adapter between Claude Code's events and the modules. Logic goes in a module with its own test, not in a hook.

## Updates must not break

A user who updates keeps three things the old version saved. Each must still load.

- **Settings** in `pluginConfigs`. A new setting gets a `default` in `plugin.json` and a fallback in `readSettings`. Never make one required.
- **The theme** in `$.store`. `readTheme` must read every theme an older version accepted.
- **The anim state** in `$.state`, which survives a reload. `step` starts over idle on a mode it doesn't know, and a field added to `Anim` must work when missing.

## Decisions

- All art is original. Do not add sprites, images, or fonts copied from elsewhere.
- The mod decorates around the chat: the band and the HUD. It does not restyle what Claude Code draws itself, such as tool rows, the spinner, or dialogs.
- The mod makes no network requests, starts no processes, and reads no environment variables. README's Privacy and security section promises this.
