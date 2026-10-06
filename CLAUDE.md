oxen-pet is a hardened fork of pixel-pet (see `SECURITY-AUDIT.md`), a Claude Code mod: a pixel pet above the prompt and a HUD below it. The repo is a marketplace with two plugins: `plugins/oxen-pet`, and `plugins/oxen-meter`, a mod with no band that measures the prompt cache for a team. `README.md` holds the layout, the commands, and the release step. This file holds the rules a change must keep; the rules for oxen-meter alone are in its own section.

## Terms

Use these words in code, comments, docs, and UI, and no others for the same thing.

- **pet**: what the mod draws. **luffy**: the default pet, and its theme, with a form per gear. **slime**: the first pet, kept built in. **custom folder**: where the user's own `<name>.theme.json` files live, outside the plugin's install folder (`custom.ts`). **theme**: one JSON object with a pet's sprite and everything else it changes (props, minis, status lines, HUD, scene), in the format `skills/oxen-pet/FORMAT.md` documents; a theme file holds one. **sprite**: the one still drawing in a theme. **clip**: a loop of frames, one of stand, run, jump, think, cheer. **frame**: one picture of a clip, made from the sprite. **body**: a pet made ready to draw by `animate`, with every clip.
- **form**: how the pet looks while one mode plays, from the theme's `forms`: its own sprite fields over the pet's, with every clip made from them.
- **mode**: what the pet is acting out (`idle`, `read`, `bash`, ...). One mode has one set of status lines and one line color. User-facing text calls a mode's animation a **motion**. **face**: one eye expression, one of the 18 in `pixels.ts`.
- **status line**: the text beside the pet. **band**: the `AbovePrompt` area the pet and status line sit in. **target**: what a tool call works on (a file, pattern, command, host, or search query), which the status line names.
- **mini**: the small drop for one running subagent, in the pet's `mini` colors. **trail**: the minis behind the pet.
- **HUD**: the window below the prompt with up to three bars. **HP** is the context window left, **MP** the 5-hour rate limit left, **ST** the 7-day rate limit left.
- **reading**: the bold number after a bar. **detail**: the grey text after the reading.
- **even pace**: where MP or ST would be if its limit were used evenly through its window, marked on the bar; **spare** is how far the reading is ahead of it. **cache timer**: the minutes the prompt cache stays warm after the main thread's last turn, shown beside HP.
- **shield**: the `tool.check` hook that asks Block it / Run it before a destructive Bash command runs unasked; **guard** is its mode, setting and module (`guard.ts`). The question names the paths an `rm` deletes, and the **size** of each: the files under it.
- **boss**: the bug a failed test run brings into the band, from `boss.ts`; a **hit** is each failed run while it stands; a passing run **defeats** it.
- **low-context alert**: the toast and red status line as HP drops under `LOW_HP`.
- **pane**: the `/pet` pane, with the session's **stats** from `stats.ts`.
- **settings**: the user's choices from the plugin's `userConfig`, read by `settings.ts`. **pace**: the speed setting as a multiplier.
- **prop**: what the pet holds beside it in a mode (a book, a terminal), the mod's or the pet's own; `props.think` also stands in for the question mark. **look**: what a theme changes beyond the pet's drawing: status lines, line colors, and the HUD.
- **scene**: a theme's background for the band, from `scene.ts`: a **ground** row below the pet, a **sky** drawing that stays put near the top right, **obstacles** standing on the ground, and **decor** behind the pet; raised decor drifts. **leap**: a running pet's jump over an obstacle, the jump clip slowed while it travels.
- **preview**: the HTML page with every motion, face, scene, status line, HUD look, and frame of a pet, from `preview.ts`. There is one; `preview_theme` and `tools/preview/build.mjs` both write it.
- **activity**: what the session is doing, as the hooks saw it; `anim.ts` turns it into the pet's next mode.

### oxen-meter terms

- **thread**: one model loop, `main` or a subagent by its agent id. **step**: one model request of a thread, as `turn.step` sees it. **step record**: what the meter keeps of a step: its four token counts (uncached input, output, cache read, cache write), model, effort, context, tool names, and times. **event record**: what it keeps around the steps (a subagent's start or stop, a handoff, an outcome, a compaction). Records hold counts, times and names, never a prompt, output, path or command.
- **context** (of a step): uncached input + cache read + cache write. **hit rate**: cache read over context.
- **gap**: the time from the start of a thread's last step to the start of its next one: how long its cache went unread. **TTL**: how long a thread's cache lives unread, `5m` or `1h`. **warm**, **cooling** (the last fifth of the TTL) and **cold** (past it) name where a thread's cache stands.
- **cold resume**: a step whose gap passed its thread's TTL and that wrote at least the **cold tokens** setting to the cache: the whole context written again.
- **handoff**: work a thread gives away, to a subagent (an Agent call) or to Codex (a Bash call of `codex` or the codex plugin's companion). **outcome**: a commit or a pull request a Bash call made.
- **collector**: the records of the session in memory, with exact totals by role, agent type and model (`record.ts`). **hook timing**: how long the meter's own hooks take (`timing.ts`).

## Before a change is done

- Run the three commands in README's Develop section. All must pass.
- Type-check with `tsc -p plugins/oxen-pet`.
- Run `node tools/preview/build.mjs` and open the preview. A JS error on the page fails the change.
- Bump `version` in `plugins/oxen-pet/.claude-plugin/plugin.json` when users should get the change.
- For oxen-meter: `claude plugin validate plugins/oxen-meter --strict`, `claude plugin test plugins/oxen-meter`, `tsc -p plugins/oxen-meter`; bump its own `version`.

## Traps

- The mod validator lets `$` pass only into top-level function declarations, not into arrow functions or nested functions.
- The poses in `theme.ts` and its `roundHalfEven` fix the slime's frames pixel for pixel; `theme.test.ts` pins them. A change to a pose changes every pet.
- `readTheme` refuses only a theme with no sprite. Everything else draws, repaired where needed, with a note saying what changed. Keep it that way: people and agents draw odd pets on purpose.
- A field added to the theme format goes in `readTheme`, in `skills/oxen-pet/FORMAT.md`, in `assets/alien.json`, and in a test. A theme kept by an older version must still read.
- Every color must read on a dark terminal and on a light one. Pick mid tones; avoid near-white and near-black text.
- Pass a string `key` to elements. A number fails the type check.
- `preview_theme` writes only through `previewPathError` in `previewPath.ts`. Do not add another `$.fs.write`; a new write goes through a guard with its own test, and in `SECURITY-AUDIT.md`.
- `register.tsx` is the adapter between Claude Code's events and the modules. Logic goes in a module with its own test, not in a hook.
- `tools/demo/record.mjs` lays out the band and the HUD as `register.tsx` does, with copies of its layout constants. A layout change in `register.tsx` goes in both; then run it and commit the new `docs/images/demo.gif` and `hud.png`.

## Updates must not break

A user who updates keeps three things the old version saved. Each must still load.

- **Settings** in `pluginConfigs`. A new setting gets a `default` in `plugin.json` and a fallback in `readSettings`. Never make one required.
- **The theme** in `$.store`, the name `/pet theme` chose, and the user's custom folder. `readTheme` must read every theme an older version accepted, and the mod never writes to the custom folder.
- **The anim state** in `$.state`, which survives a reload. `step` starts over idle on a mode it doesn't know, and a field added to `Anim` must work when missing.

## Decisions

- All art is drawn for this repo. Do not add sprites, images, or fonts copied from elsewhere, fan art included. The default Luffy is fan art of a character the repo does not own, drawn here by the owner's choice; keep README's notice that One Piece belongs to its owners and the repo is not affiliated.
- The mod decorates around the chat: the band, the HUD, and the `/pet` pane. It does not restyle what Claude Code draws itself, such as tool rows, the spinner, or dialogs.
- The shield may refuse a call, and only a Bash call Claude Code would run unasked whose command matches `guard.ts`. Keep it fail-closed on the user's answer and fail-open on the mod's own errors.
- The desktop has no Raster: whatever the band or the pane draws on the terminal draws as `Svg` there. Keep a band's SVG under the element's 131072 characters (`DESKTOP_BAND_W`).
- The mod makes no network requests, starts no processes, and reads no environment variables. `SECURITY-AUDIT.md` lists the checks; run them before a push.
- Upstream changes come in only by `git fetch upstream`, a full read of the diff, and a cherry-pick. Never install upstream's marketplace.

## oxen-meter rules

- It stays out of the cache's way: no `prompt.compose`, `session.append` or `prompt.fill`, no rewrite of a step's model or effort, no answer in the engine's place. Its output is its pane, toasts, command output, and its own files.
- The hot path (`turn.step`, `tool.call`) only adds to the collector in place and returns: no file, list or store call there. `timing.ts` measures it, and the pane shows the numbers.
- It fails open on its own errors: no `.catch` that refuses. A hook that throws is skipped, and the step, call or message goes on as Claude Code sent it.
- A record keeps metadata only (Terms above). A new field is a count, a time, or a name from a fixed set; never text the model or the user wrote.
- It draws no `AbovePrompt` and no `PromptHint`, so it runs beside oxen-pet; its pane is `Text` only, so it draws alike on the terminal and the desktop.
