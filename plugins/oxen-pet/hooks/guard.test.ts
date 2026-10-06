import { expect, test } from 'claude-code/testing'

import { GUARD_CAP, guardLine, guardQuestion, riskOf, sizeOf } from './guard'
import type { GuardFs } from './guard'

test('a recursive rm, a force push, a hard reset and a forced clean are risky; everyday commands are not', () => {
  for (const command of ['rm -rf build', 'rm -r old', 'sudo rm -Rf /var/tmp/x', 'git push --force origin main', 'git push -f', 'git reset --hard HEAD~1', 'git clean -fdx', 'npm test && rm -fr dist', '/bin/rm -rf x', '/usr/bin/git push -f']) {
    expect(riskOf(command)).toBeDefined()
  }
  for (const command of ['rm notes.txt', 'ls -la', 'git push origin main', 'git push --force-with-lease', 'git reset HEAD~1', 'git status', 'npm test', 'git clean -n', 'echo done']) {
    expect(riskOf(command)).toBeUndefined()
  }
})

test('dropping data, destroying infrastructure, and deleting with find are risky too', () => {
  for (const command of ['psql -c "DROP TABLE users"', 'mysql -e "truncate table logs"', 'terraform destroy', 'kubectl delete ns staging', 'find . -name "*.log" -delete', 'git branch -D feature', 'git stash clear', 'docker system prune -af', 'git checkout -- .', 'git restore .']) {
    expect(riskOf(command)).toBeDefined()
  }
  expect(riskOf('git restore --staged .')).toBeUndefined()
})

test('a recursive rm names its targets, and marks the ones it cannot size from its spelling', () => {
  expect(riskOf('rm -rf build dist')?.targets).toEqual([{ path: 'build' }, { path: 'dist' }])
  expect(riskOf('rm -rf -- /tmp/a')?.targets).toEqual([{ path: '/tmp/a' }])
  expect(riskOf('rm -rf *.log $HOME/x ~/y')?.targets).toEqual([
    { path: '*.log', unsized: true },
    { path: '$HOME/x', unsized: true },
    { path: '~/y', unsized: true },
  ])
  // After a cd, a relative path names a different folder than the one the mod would look in.
  expect(riskOf('cd web && rm -rf build')?.targets).toEqual([{ path: 'build', unsized: true }])
  expect(riskOf("rm -rf 'my dir'")?.targets).toEqual([{ path: 'my dir' }])
  expect(riskOf('git reset --hard')?.targets).toEqual([])
})

/** A file system in memory: a folder is a record of its entries, a file is null, a link is a string. */
function fakeFs(root: Record<string, unknown>): GuardFs {
  const at = (path: string) => path.split('/').filter(Boolean).reduce<unknown>((node, name) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[name] : undefined), root)
  const kindOf = (node: unknown) => (typeof node === 'string' ? 'other' : node === null ? 'file' : 'dir')
  return {
    stat: async path => {
      const node = at(path)
      if (node === undefined) {
        throw new Error(`ENOENT: ${path}`)
      }
      return { kind: kindOf(node), isLink: typeof node === 'string' }
    },
    list: async path => Object.entries(at(path) as Record<string, unknown>).map(([name, node]) => ({ name, kind: kindOf(node), isLink: typeof node === 'string' })),
  }
}

test('the size of a target counts its files, never follows a link, and stops at the cap', async () => {
  const fs = fakeFs({ build: { 'a.js': null, 'b.js': null, assets: { 'c.png': null, 'd.png': null }, shared: '/elsewhere' }, 'one.txt': null })
  expect(await sizeOf('build', fs)).toEqual({ files: 5 })
  expect(await sizeOf('one.txt', fs)).toEqual({ files: 1 })
  expect(await sizeOf('missing', fs)).toEqual({ files: 0, isMissing: true })

  const big = fakeFs({ big: Object.fromEntries(Array.from({ length: GUARD_CAP + 50 }, (_, i) => [`f${i}`, null])) })
  expect(await sizeOf('big', big)).toEqual({ files: GUARD_CAP, isCapped: true })
})

test('the question says what the command does, how much each target holds, and asks to run it', () => {
  const risk = riskOf('rm -rf build *.log missing /tmp/gone')!
  const question = guardQuestion('rm -rf build *.log missing /tmp/gone', risk, [{ files: 132 }, undefined, { files: 0, isMissing: true }, { files: 0, isMissing: true }])
  expect(question).toContain('deletes files and folders for good')
  expect(question).toContain('build: 132 files')
  expect(question).toContain('*.log: not sized')
  // A relative path the mod cannot find may be under the folder Claude's shell moved to.
  expect(question).toContain('missing: not found from the project folder')
  expect(question).toContain('/tmp/gone: not there')
  expect(question.endsWith('?')).toBe(true)

  const capped = guardQuestion('rm -rf big', riskOf('rm -rf big')!, [{ files: GUARD_CAP, isCapped: true }])
  expect(capped).toContain(`big: ${GUARD_CAP}+ files`)
  // A long command is cut, so the dialog stays readable.
  expect(guardQuestion(`rm -rf ${'x'.repeat(300)}`, riskOf(`rm -rf ${'x'.repeat(300)}`)!, []).length).toBeLessThan(400)
})

test('the pet says what the shield did once the answer is in', () => {
  expect(guardLine('blocked')).toContain('blocked')
  expect(guardLine('ran')).toContain('let it through')
})
