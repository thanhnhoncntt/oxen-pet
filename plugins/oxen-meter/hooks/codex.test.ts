import { expect, test } from 'claude-code/testing'

import { codexCallOf, outcomeOf } from './codex'

test('the codex plugin\'s companion script is a Codex call, named by its sub-command', () => {
  expect(codexCallOf('node "/Users/me/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs" task --write "fix the bug"')).toEqual({ sub: 'task' })
  expect(codexCallOf("node '/x/codex-companion.mjs' adversarial-review --base main")).toEqual({ sub: 'adversarial-review' })
  expect(codexCallOf('node /x/codex-companion.mjs result')).toEqual({ sub: 'result' })
})

test('the codex CLI is a Codex call at the start of the command or of any part of it', () => {
  expect(codexCallOf('codex exec "review the diff"')).toEqual({ sub: 'exec' })
  expect(codexCallOf('cd repo && codex exec --full-auto "x"')).toEqual({ sub: 'exec' })
  expect(codexCallOf('OPENAI_LOG=1 codex review')).toEqual({ sub: 'review' })
  expect(codexCallOf('codex "explain this"')).toEqual({ sub: 'run' })
  expect(codexCallOf('codex')).toEqual({ sub: 'run' })
})

test('a command that only mentions codex is not a Codex call', () => {
  for (const c of ['ls ~/.codex/sessions', 'grep -r codex .', 'cat codex.md', 'echo codex', 'npm i @openai/codex-sdk', 'git log --grep codex']) {
    expect(codexCallOf(c)).toBeUndefined()
  }
})

test('git commit and gh pr create are outcomes, anywhere in the command', () => {
  expect(outcomeOf('git commit -m "x"')).toBe('commit')
  expect(outcomeOf('git add -A && git commit -m "$(cat <<EOF\nx\nEOF\n)"')).toBe('commit')
  expect(outcomeOf('git -C repo commit --amend --no-edit')).toBe('commit')
  expect(outcomeOf('gh pr create --title x --body y')).toBe('pr')
  expect(outcomeOf('git push && gh pr create --fill')).toBe('pr')
})

test('other git and gh commands are no outcome', () => {
  for (const c of ['git status', 'git log --grep commit', 'echo git commit', 'gh pr view 3', 'gh pr list', 'git commit-tree x']) {
    expect(outcomeOf(c)).toBeUndefined()
  }
})
