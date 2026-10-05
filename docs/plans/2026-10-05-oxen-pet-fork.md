# oxen-pet Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the cloned pixel-pet repo into `oxen-pet`, a hardened fork installed from a private GitHub repo.

**Architecture:** Same mod, renamed. One new pure module (`previewPath.ts`) guards where `preview_theme` may write; `register.tsx` calls it. Dev-only tooling that spawns processes is removed. A `SECURITY-AUDIT.md` records what was audited.

**Tech Stack:** Claude Code mod API (TS/TSX, `claude-code` + `claude-code/testing`), Node 24 for `tools/preview`, `gh` CLI.

**Spec:** `docs/specs/2026-10-05-oxen-pet-fork-design.md`

## Global Constraints

- Name `oxen-pet` everywhere: marketplace, plugin, `PluginState` key, tools `mcp__oxen-pet__*`, skill `/oxen-pet:oxen-pet`.
- Audited upstream commit: `02eb10af1788ee0514ed72ee3bf1cb7ad46b0764`. `upstream` push URL stays `DISABLED`.
- LICENSE keeps `Copyright (c) 2026 halluqinate` and adds the fork's line.
- The mod makes no network requests, starts no processes, reads no environment variables.
- Settings saved by an older version must still load (`readSettings` fallbacks).

## Review Focus

- A `path` like `/tmp/x/../../Users/me/.zshrc` must be refused even though it is absolute.
- A file named `oxen-pet-preview.html.sh` or `oxen-pet-preview` (no `.html`) must be refused.
- A relative path `oxen-pet-preview.html` must be refused (the mod's cwd is unknown).
- A non-string `path` (number, object) must be refused with the same "`path` is the HTML file to write" message as a missing one.
- A user who explicitly set `targets: true` before the default flip keeps it on.

---

### Task 1: Rename pixel-pet → oxen-pet

**Files:** `git mv plugins/pixel-pet plugins/oxen-pet`, `git mv plugins/oxen-pet/skills/pixel-pet plugins/oxen-pet/skills/oxen-pet`; text replace in `.claude-plugin/marketplace.json`, `plugin.json`, `register.tsx`, `theme.ts`, `ui.test.ts`, `SKILL.md`, `types/index.d.ts`, `README.md`, `CLAUDE.md`, `tools/preview/build.mjs`. Owner/author → `NhonNguyen`, homepage/repository → `https://github.com/thanhnhoncntt/oxen-pet`. Version → `1.0.0`.

- [ ] Step 1: `git mv` both dirs; `sed -i '' 's/pixel-pet/oxen-pet/g'` over the files above.
- [ ] Step 2: Edit marketplace/plugin owner, author, homepage, repository. LICENSE: add `Copyright (c) 2026 NhonNguyen (oxen-pet fork)`.
- [ ] Step 3: `grep -rnI pixel-pet . --exclude-dir=.git --exclude-dir=specs --exclude-dir=plans` → only provenance lines in README/CLAUDE.md/LICENSE.
- [ ] Step 4: `claude plugin test plugins/oxen-pet` → all pass.
- [ ] Step 5: Commit `Rename pixel-pet to oxen-pet`.

### Task 2: Preview path guard

**Files:** Create `plugins/oxen-pet/hooks/previewPath.ts`, `plugins/oxen-pet/hooks/previewPath.test.ts`. Modify `register.tsx` (preview_theme handler), `ui.test.ts` (paths `/tmp/cat.html`, `/tmp/mochi.html` → `/tmp/oxen-pet-preview-cat.html`, `/tmp/oxen-pet-preview-mochi.html`), `SKILL.md` line "such as `/tmp/cat.theme.html`" → `/tmp/oxen-pet-preview-cat.html` and state the rule.

**Interfaces:** Produces `previewPathError(path: unknown): string | undefined` — undefined when allowed, else the deny reason.

- [ ] Step 1: Write failing test:

```ts
import { expect, test } from 'claude-code/testing'

import { PREVIEW_PREFIX, previewPathError } from './previewPath'

test('a preview file in any folder is allowed', () => {
  expect(previewPathError('/tmp/oxen-pet-preview.html')).toBeUndefined()
  expect(previewPathError('/var/folders/x/T/oxen-pet-preview-cat.html')).toBeUndefined()
  expect(previewPathError('C:\\Temp\\oxen-pet-preview-cat.html')).toBeUndefined()
})

test('a missing or non-string path is refused', () => {
  for (const p of [undefined, '', 42, {}]) {
    expect(previewPathError(p)).toContain('`path` is the HTML file to write')
  }
})

test('a relative path or one with .. is refused', () => {
  expect(previewPathError('oxen-pet-preview.html')).toContain('absolute')
  expect(previewPathError('/tmp/a/../../Users/me/oxen-pet-preview.html')).toContain('..')
})

test('any other file name is refused', () => {
  for (const p of ['/Users/me/.zshrc', '/tmp/cat.html', '/tmp/oxen-pet-preview.html.sh', '/tmp/oxen-pet-preview', '/tmp/oxen-pet-preview/x.html']) {
    expect(previewPathError(p)).toContain(PREVIEW_PREFIX)
  }
})
```

- [ ] Step 2: `claude plugin test plugins/oxen-pet` → FAIL (module missing).
- [ ] Step 3: Implement:

```ts
/** Where preview_theme may write: an absolute path with no `..`, to a file named oxen-pet-preview….html. */
export const PREVIEW_PREFIX = 'oxen-pet-preview'

const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

/** Why preview_theme must not write to `path`, or undefined when it may. */
export function previewPathError(path: unknown): string | undefined {
  if (typeof path !== 'string' || path === '') {
    return '`path` is the HTML file to write.'
  }
  if (!isAbsolute(path)) {
    return '`path` must be absolute.'
  }
  const parts = path.split(/[\\/]/)
  if (parts.includes('..')) {
    return '`path` must not contain `..`.'
  }
  const name = parts[parts.length - 1]
  if (!name.startsWith(PREVIEW_PREFIX) || !name.endsWith('.html')) {
    return `\`path\` must name a file that starts with ${PREVIEW_PREFIX} and ends with .html, such as /tmp/${PREVIEW_PREFIX}-cat.html.`
  }
  return undefined
}
```

- [ ] Step 4: In `register.tsx` replace the `typeof path !== 'string'` check with
  `const bad = previewPathError(path); if (bad) return { deny: \`No preview was written: ${bad}\` }` and cast `path as string` after. Update `ui.test.ts` paths and add one case: preview to `/Users/me/.zshrc` is denied and writes nothing.
- [ ] Step 5: tests pass; commit `Restrict preview_theme to oxen-pet-preview*.html files`.

### Task 3: Targets off by default

**Files:** `plugins/oxen-pet/hooks/settings.ts` (`DEFAULTS.targets: false`), `plugin.json` (`targets.default: false`), `settings.test.ts`, README settings table.

- [ ] Step 1: Add test `expect(readSettings({}).targets).toBe(false)` and `expect(readSettings({ targets: true }).targets).toBe(true)`; run → FAIL.
- [ ] Step 2: Flip both defaults; run → PASS (check `ui.test.ts` too: any test expecting a target in the status line must pass `targets: true` in its options).
- [ ] Step 3: Commit `Hide tool targets in the status line by default`.

### Task 4: Remove process-spawning dev tooling, rewrite docs

**Files:** delete `tools/demo/`, `docs/images/`; rewrite `README.md` (install from `thanhnhoncntt/oxen-pet`, no gifs, no author socials, provenance section); `CLAUDE.md` (drop `tools/demo` trap, rename); create `SECURITY-AUDIT.md`.

- [ ] Step 1: `git rm -r tools/demo docs/images`.
- [ ] Step 2: Rewrite README/CLAUDE.md; write SECURITY-AUDIT.md with: audited commit, `calls:` line from `claude plugin validate plugins/oxen-pet`, grep commands + results, upstream review procedure (`git fetch upstream && git log main..upstream/main && git diff main...upstream/main -- plugins/` then cherry-pick, re-run grep, re-run validate).
- [ ] Step 3: Commit `Drop demo tooling; document the fork and its audit`.

### Task 5: Verify and publish

- [ ] `claude plugin validate . --strict`; `claude plugin validate plugins/oxen-pet --strict`; `claude plugin test plugins/oxen-pet`.
- [ ] `node tools/preview/build.mjs` runs without error.
- [ ] One `claude -p --plugin-dir plugins/oxen-pet` load to generate types, then `npx -y -p typescript tsc -p plugins/oxen-pet`.
- [ ] `gh repo create thanhnhoncntt/oxen-pet --private --source . --remote origin --push`.
- [ ] `claude plugin marketplace add thanhnhoncntt/oxen-pet && claude plugin install oxen-pet@oxen-pet`; `claude plugin list` shows it enabled.
