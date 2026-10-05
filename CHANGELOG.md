# Changelog

What each version of oxen-pet adds or changes for a user. Installed copies update only when the
version in `plugins/oxen-pet/.claude-plugin/plugin.json` changes; see README's Update section.

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
