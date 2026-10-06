#!/usr/bin/env node
// oxen-meter's command line, for the tools a Claude Code mod cannot reach: it imports Codex CLI's (and Devin CLI's)
// sessions into the meter's data folder, prints the report over every tool, and writes the export for the team.
// Run: node tools/meter/oxen-meter.mjs <import [days] | report [days] | export [days]> [--data <folder>]
//        [--codex-home <folder>] [--devin-home <folder>] [--claude-settings <file>]
//      node tools/meter/oxen-meter.mjs setup codex|devin [--write [--yes]]   adds the CLI's hooks to Codex or Devin
//      node tools/meter/oxen-meter.mjs hook codex|devin                       what those hooks run, the event on stdin
// Needs Node 22.18 or later. It reads the files named below and writes only to the data folder, through the mod's guard;
// it makes no network request and starts no process. See SECURITY-AUDIT.md.
import './lib/quiet.mjs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Everything else loads inside the try, so a hook whose Node is too old, or whose files are half updated, prints
// nothing and exits 0 rather than showing the user a failed hook.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hook = process.argv[2] === 'hook'
  try {
    const { argsOf, run } = await import('./lib/cli.mjs')
    const { rest, flags } = argsOf(process.argv.slice(2))
    const out = await run(rest, flags)
    if (hook) {
      process.stdout.write(out.text)
    } else {
      ;(out.code === 0 ? console.log : console.error)(out.text)
      process.exitCode = out.code
    }
  } catch (err) {
    if (!hook) {
      console.error(`oxen-meter: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  }
}
