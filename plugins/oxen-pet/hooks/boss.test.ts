import { expect, test } from 'claude-code/testing'

import { BOSS_W, DEFEAT_MS, bossAfter, bossOnScreen, drawBoss, isTestCommand, testOutcome } from './boss'
import { HEIGHT } from './pixels'

test('test runs of the common tools count; other commands do not', () => {
  for (const command of ['npm test', 'npm run test -- --watch=false', 'pnpm test', 'yarn test', 'bun test', 'npx vitest run', 'jest src', 'pytest -q', 'python -m pytest', 'go test ./...', 'cargo test', 'mvn test', './gradlew test', 'dotnet test', 'claude plugin test plugins/oxen-pet', 'make test', 'cd web && npm test']) {
    expect(isTestCommand(command)).toBe(true)
  }
  for (const command of ['npm install', 'git checkout test-branch', 'ls tests', 'echo test', 'cat jest.config.js', 'npm run build']) {
    expect(isTestCommand(command)).toBe(false)
  }
})

test('a run that errored failed; one that answered passed; a refused, interrupted, or backgrounded one says nothing', () => {
  expect(testOutcome({ isError: true, result: undefined, text: 'Exit code 1' })).toBe('failed')
  expect(testOutcome({ result: { stdout: 'ok', stderr: '', interrupted: false } })).toBe('passed')
  expect(testOutcome({ deny: 'no' })).toBeUndefined()
  expect(testOutcome({ result: { stdout: '', stderr: '', interrupted: true } })).toBeUndefined()
  expect(testOutcome({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } })).toBeUndefined()
})

test('a failed run brings the boss and each one after hits harder; a passing run defeats it; a failure after that brings a new one', () => {
  const boss = bossAfter(undefined, 'failed', 1000)
  expect(boss).toEqual({ since: 1000, hits: 1 })
  expect(bossAfter(boss, 'failed', 2000)).toEqual({ since: 1000, hits: 2 })
  expect(bossAfter(undefined, 'passed', 2000)).toBeUndefined()
  const beaten = bossAfter(boss, 'passed', 3000)
  expect(beaten).toEqual({ since: 1000, hits: 1, defeatedAt: 3000 })
  expect(bossAfter(beaten, 'passed', 3100)).toEqual(beaten)
  expect(bossAfter(beaten, 'failed', 3200)).toEqual({ since: 3200, hits: 1 })
  expect(bossAfter(boss, undefined, 3300)).toEqual(boss)
})

test('a defeated boss leaves the screen once its defeat has played', () => {
  const beaten = { since: 0, hits: 1, defeatedAt: 1000 }
  expect(bossOnScreen(beaten, 1000 + DEFEAT_MS - 1)).toBe(beaten)
  expect(bossOnScreen(beaten, 1000 + DEFEAT_MS)).toBeUndefined()
  expect(bossOnScreen(undefined, 0)).toBeUndefined()
})

const lit = (px: number[]) => px.filter(c => c !== -1).length

test('the boss is drawn on the ground, bobs, shows a pip per hit, and flashes then puffs away when defeated', () => {
  const one = drawBoss({ since: 0, hits: 1 }, 0)
  expect([one.w, one.h]).toEqual([BOSS_W, HEIGHT])
  expect(one.px.slice((HEIGHT - 1) * BOSS_W).some(c => c !== -1)).toBe(true)
  expect(drawBoss({ since: 0, hits: 1 }, 400).px).not.toEqual(one.px)
  expect(lit(drawBoss({ since: 0, hits: 3 }, 0).px)).toBeGreaterThan(lit(one.px))
  expect(lit(drawBoss({ since: 0, hits: 9 }, 0).px)).toBe(lit(drawBoss({ since: 0, hits: 5 }, 0).px))

  const beaten = { since: 0, hits: 1, defeatedAt: 1000 }
  expect(drawBoss(beaten, 1050).px).not.toEqual(drawBoss(beaten, 1150).px)
  expect(lit(drawBoss(beaten, 1000 + DEFEAT_MS - 100).px)).toBeLessThan(lit(one.px))
})
