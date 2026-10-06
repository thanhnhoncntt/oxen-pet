import { expect, test } from 'claude-code/testing'

import { animate, readTheme } from './theme'
import { FACES } from './pixels'
import { previewPage } from './preview'

const read = readTheme({ name: 'Tom <&> Jerry', sprite: ['.aaa.', 'aaaaa', 'aaaaa'], palette: { a: '#336699' } })
const body = read.errors ? undefined : animate(read.theme)

test('the preview shows every mode with when it plays, every face, and every clip', () => {
  const page = previewPage(body!, [])
  for (const part of ['A turn starts', 'A tool call fails', 'A tool call ends', 'A destructive command waits for your answer', '<h2>Boss</h2>', 'the next passing run defeats it', '16 frames at 8 fps', '18 frames at 10 fps']) {
    expect(page).toContain(part)
  }
  for (const face of FACES) {
    expect(page).toContain(`<b>${face}</b>`)
  }
  expect(page).not.toContain('class="notes"')
})

test('the preview escapes the name and lists the notes', () => {
  const page = previewPage(body!, ['A <b> note'])
  expect(page).toContain('<h1>Tom &#60;&#38;&#62; Jerry</h1>')
  expect(page).toContain('<li>A &#60;b&#62; note</li>')
})

test('each HUD row in the preview has both sides of the window, as the terminal draws it', () => {
  const page = previewPage(body!, [])
  const huds = [...page.matchAll(/<pre class="hud"[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1] as string)
  expect(huds.length).toBeGreaterThan(0)
  for (const hud of huds) {
    for (const line of hud.split('\n').slice(1, -1)) {
      expect(line.split('█').length - 1).toBe(2)
    }
  }
})
