import { expect, test } from 'claude-code/testing'

import { animate, maxSize, readTheme, restingFrame } from './theme'
import { compose } from './pixels'

// The default slime, as assets/slime.json spells it.
const slime = {
  name: 'slime',
  scale: 0.8,
  sprite: [
    '........a........',
    '.......aha.......',
    '......agfda......',
    '....aagffddaa....',
    '...ahgffffddda...',
    '..ahhgffffffdda..',
    '.agggfffffffddda.',
    '.afffffffffdddca.',
    'acdffffffffdddcca',
    '.accddddddddddca.',
    '..aaaaaaaaaaaaa..',
  ],
  palette: { a: '#1e3a8a', c: '#2a5fd6', d: '#3d84f0', f: '#5aa9ff', g: '#9ad2ff', h: '#e3f4ff' },
  outline: 'a',
  eyes: [[4, 5], [10, 5]],
  cheeks: [[3, 6], [13, 6]],
  cheekColor: '#ff8aaa',
}

const themeOf = (v: unknown) => {
  const read = readTheme(v)
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  return read.theme
}

test('the slime animates to the frames it was first drawn with', () => {
  const body = animate(themeOf(slime))
  const rest = body.clips.stand.frames[0]!
  expect(rest.g.slice(10)).toEqual([
    '...................',
    '.........a.........',
    '........aha........',
    '......aagfdaa......',
    '.....aagffddaa.....',
    '....ahhgffffdda....',
    '...ag*gfffffd*da...',
    '...affffffffddca...',
    '...accddddddddca...',
    '....aaaaaaaaaaa....',
  ])
  expect([rest.l, rest.r]).toEqual([[6, 14], [10, 14]])
  expect(body.clips.jump.frames[6]!.g[4]).toBe('.........a.........')
  expect(body.clips.jump.frames[6]!.l).toEqual([6, 7])
  expect(Object.fromEntries(Object.entries(body.clips).map(([k, c]) => [k, [c.fps, c.frames.length]]))).toEqual({
    stand: [8, 16], run: [12, 8], jump: [12, 14], think: [6, 12], cheer: [10, 18],
  })
})

test('a pet fills in its defaults', () => {
  const pet = themeOf({ sprite: ['aaaaaaa', 'aaaaaaa', 'aaaaaaa'], palette: { a: '#123456' }, eyes: [[0, 1], [4, 1]] })
  expect([pet.name, pet.scale, pet.eyeColor, pet.mini.body]).toEqual(['pet', 1, '#000000', '#3d84f0'])
})



test('the resting frame marks the pupils with @ and starts at the first row in use', () => {
  const rows = restingFrame(animate(themeOf(slime))).split('\n')
  expect(rows[0]).toBe('.........a.........')
  expect(rows[5]).toBe('...ag*@@ff@@d*da...')
})

test('at scale 1 the resting frame is the sprite itself, at an even width or an odd one', () => {
  for (const sprite of [['.aaaaaa.', 'abbaabba', 'abbaabba', 'aaaaaaaa'], ['..aaaaa..', '.abbabba.', 'abbbabbba', 'aaaaaaaaa']]) {
    const body = animate(themeOf({ sprite, palette: { a: '#111111', b: '#999999' }, eyes: [[0, 1], [5, 1]] }))
    const rows = body.clips.stand.frames[0]!.g.filter(r => /[^.]/.test(r)).map(r => r.replace(/^\.+|\.+$/g, ''))
    expect(rows).toEqual(sprite.map(r => r.replace(/^\.+|\.+$/g, '')))
  }
})


test('a sprite too big for scale 1 is drawn smaller, with a note', () => {
  expect(maxSize(1)).toEqual({ w: 15, h: 10 })
  const read = readTheme({ ...slime, scale: 1 })
  expect(read.errors).toBeUndefined()
  expect(read.errors ? 0 : read.theme.scale).toBe(0.89)
  expect(read.errors ? [] : read.notes).toEqual([
    'A 17×11 sprite is drawn at scale 0.89 to fit every pose. At scale 1 the largest is 15×10, and a smaller scale blurs detail.',
  ])
})

test('only a pet with no sprite is refused; the rest is repaired and noted', () => {
  expect(readTheme('a cat').errors).toEqual(['A theme is a JSON object with a `sprite`.'])
  expect(readTheme({ palette: { a: '#123456' } }).errors).toEqual(['`sprite` is a list of text rows, one character per pixel.'])

  const read = readTheme({ sprite: ['ab*', 'a'], palette: { a: '#abc', b: 'blue' }, eyes: 'big', mini: { top: '#fff' } })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(read.theme.sprite).toEqual(['ab.', 'a..'])
  expect(read.theme.palette).toEqual({ a: '#aabbcc' })
  expect(read.theme.eyes).toBeUndefined()
  expect(read.notes).toEqual([
    'Rows of different widths were padded with "." to 3.',
    'The sprite\'s "*", "+", "@" pixels are drawn clear: the mod marks its own drawings with them.',
    'The palette color for "b", "blue", is not "#rrggbb", so "b" is drawn clear.',
    '"b" has no palette color, so it is drawn clear.',
    '`eyes` is two [x, y] points, so the pet has no eyes and no faces.',
    '`mini` needs three colors, `top`, `body`, and `edge`, so the minis keep the slime\'s blues.',
  ])
})

test('overlapping eyes and a cheek in an eye box draw anyway, with notes', () => {
  const read = readTheme({ sprite: ['aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa'], palette: { a: '#123456' }, eyes: [[0, 1], [2, 1]], cheeks: [[1, 2], [6, 3]] })
  expect(read.errors ? [] : read.notes).toEqual([
    'The eye boxes overlap, so the wide eyes and hearts merge into one shape. Pupils 4 pixels apart keep them apart.',
    'A cheek sits inside an eye box, where some faces draw over it.',
  ])
  expect(read.errors ? undefined : read.theme.cheekColor).toBe('#ff8aaa')
})

test('a pet with no eyes draws no faces, and its resting frame marks no pupils', () => {
  const body = animate(themeOf({ sprite: ['.aaa.', 'aaaaa', 'aaaaa'], palette: { a: '#123456' } }))
  expect(body.eye).toEqual({})
  expect(restingFrame(body)).not.toContain('@')
})

test('a pet with fields this version does not know still reads', () => {
  const read = readTheme({ ...slime, frames: { jump: [] }, author: 'someone' })
  expect(read.errors).toBeUndefined()
  expect(read.errors ? [] : read.notes).toEqual([])
})

test('a pet carries its own props, mini, lines, line colors, and HUD look', () => {
  const read = readTheme({
    sprite: ['aaa'],
    palette: { a: '#44cc44', y: '#ffe25a' },
    props: { read: ['yy', 'yy'], web: [['y'], ['.y']], bash: false },
    miniSprite: ['.y.', 'yyy'],
    lines: { think: ['probing the problem'], read: 'scanning {}' },
    lineColors: { think: '#44cc44' },
    hud: { frame: '#4c4', hp: { label: '☢ FUEL', fill: ['#003300', '#00ff88'] }, st: false },
  })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(read.notes).toEqual([])
  expect(read.theme.props).toEqual({ read: [['yy', 'yy']], web: [['y'], ['.y']], bash: null })
  expect(read.theme.miniSprite).toEqual(['.y.', 'yyy'])
  expect(read.theme.lines).toEqual({ think: ['probing the problem'], read: ['scanning {}'] })
  expect(read.theme.lineColors).toEqual({ think: '#44cc44' })
  expect(read.theme.hud).toEqual({ frame: '#44cc44', hp: { label: '☢ FUEL', fill: ['#003300', '#00ff88'] }, st: false })
  expect(animate(read.theme).look.hud.st).toBe(false)
})

test('a look the mod cannot use is left out or cut, with a note', () => {
  const read = readTheme({
    sprite: ['aaa'],
    palette: { a: '#44cc44' },
    props: { run: ['a'], fly: ['a'], read: 'book', edit: Array.from({ length: 22 }, () => 'a'.repeat(18)) },
    miniSprite: ['aaaaaaa'],
    lines: { read: [], think: ['x'.repeat(50)] },
    lineColors: { read: 'green' },
    hud: { frame: 'blue', hp: { label: 'FUELTANK', fill: ['#000'] }, mp: 'none' },
  })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(read.theme.props.edit?.[0]).toHaveLength(20)
  expect(read.theme.props.edit?.[0]?.[0]).toHaveLength(16)
  expect(read.theme.miniSprite).toEqual(['aaaaa'])
  expect(read.theme.lines).toEqual({ think: ['x'.repeat(40)] })
  expect(read.theme.hud).toEqual({ hp: { label: 'FUELTA' } })
  expect(read.notes).toEqual([
    '`miniSprite` is 7×1, past the largest, 5×7, so its bottom-left part is kept.',
    '"run" in `props` is not a mode that can hold a prop, so it is left out.',
    '"fly" in `props` is not a mode that can hold a prop, so it is left out.',
    'the read prop is not a list of text rows, so it is left out.',
    'the edit prop is 18×22, past the largest, 16×20, so its bottom-left part is kept.',
    '`lines.read` has no text, so the read mode keeps its own lines.',
    'Lines in `lines.think` are cut to 40 characters.',
    '`lineColors.read`, "green", is not "#rrggbb", so the read mode keeps its own color.',
    '`hud.frame`, "blue", is not "#rrggbb", so the frame keeps its own color.',
    '`hud.hp.label` is cut to 6 characters.',
    '`hud.hp.fill` is two "#rrggbb" colors, so the bar keeps its own fill.',
    '`hud.mp` is an object or false, so that bar keeps its own look.',
  ])
})

test('a scene keeps its ground, obstacles, and decor in the palette, and notes what it cut', () => {
  const palette = { ...slime.palette, r: '#9aa0b0' }
  const read = readTheme({ ...slime, palette, scene: { ground: ['rr'], obstacles: [['rrrrrrrrrr', 'rrrrrrrrrr']], decor: ['zz'], every: 10 } })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(read.theme.scene).toEqual({ ground: ['rr'], obstacles: [['rrrrrrrr', 'rrrrrrrr']], decor: [['zz']], every: 30 })
  expect(read.notes.some(n => n.includes('`scene.obstacles` 1 is 10×2, past the largest, 8×6'))).toBe(true)
  expect(read.notes.some(n => n.includes('In `scene.decor` 1, "z" has no palette color'))).toBe(true)
  expect(read.notes.some(n => n.includes('`scene.every` is a number of columns from 30 to 120, so it is 30.'))).toBe(true)
})

test('a scene with nothing to draw is left out, with a note', () => {
  const read = readTheme({ ...slime, scene: {} })
  expect(read.errors ? undefined : [read.theme.scene, read.notes]).toEqual([undefined, ['`scene` has no ground, sky, obstacles, or decor to draw, so the pet has no scene.']])
  expect(themeOf({ ...slime, scene: { ground: ['a'] } }).scene).toEqual({ ground: ['a'], obstacles: [], decor: [], every: 40 })
  expect(themeOf({ ...slime, scene: { sky: ['.a.', 'aaa'] } }).scene).toEqual({ sky: ['.a.', 'aaa'], obstacles: [], decor: [], every: 40 })
})

test('a theme sets the guard mode\'s prop, lines, and line color like any other mode\'s', () => {
  const read = readTheme({ name: 'g', sprite: ['ddd', 'ddd'], palette: { d: '#3d84f0' }, props: { guard: [['d.d', '.d.']] }, lines: { guard: 'not that one!' }, lineColors: { guard: '#d9822b' } })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(read.notes).toEqual([])
  expect(read.theme.props.guard).toEqual([['d.d', '.d.']])
  expect(read.theme.lines.guard).toEqual(['not that one!'])
  expect(read.theme.lineColors.guard).toBe('#d9822b')
})

// A pet with a form per mode: `forms` changes how the pet looks while that mode plays.
const BASE = { name: 'shifty', sprite: ['aaaaaaa', 'aaaaaaa', 'aaaaaaa'], palette: { a: '#336699', b: '#ff0000' }, eyes: [[0, 1], [4, 1]] }
const has = (c: { px: number[] }, color: string) => c.px.includes(parseInt(color.slice(1), 16))

test('a form that only recolors draws the base sprite in its own colors, in its mode alone', () => {
  const read = readTheme({ ...BASE, forms: { bash: { palette: { a: '#ff8800' } } } })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(read.notes).toEqual([])
  const body = animate(read.theme)
  expect(has(compose(body, 'bash', 0, 1), '#ff8800')).toBe(true)
  expect(has(compose(body, 'bash', 0, 1), '#336699')).toBe(false)
  expect(has(compose(body, 'idle', 0, 1), '#ff8800')).toBe(false)
  expect(has(compose(body, 'idle', 0, 1), '#336699')).toBe(true)
})

test('a form with its own sprite draws it in every clip of its mode, keeping the base eyes and palette unless it sets its own', () => {
  const read = readTheme({ ...BASE, forms: { cheer: { sprite: ['.bbb.', 'bbbbb', 'bbbbb', 'bbbbb'] }, run: { sprite: ['bbb', 'bbb'] , eyes: [[0, 0], [1, 0]] } } })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  const body = animate(read.theme)
  expect(has(compose(body, 'cheer', 300, 1), '#ff0000')).toBe(true)
  expect(has(compose(body, 'idle', 300, 1), '#ff0000')).toBe(false)
  expect(read.theme.forms.cheer?.eyes).toEqual([[0, 1], [4, 1]])
  // A form's sprite is read like the pet's own, and its notes say which form they are about.
  expect(read.notes).toContain('forms.run: The eye boxes overlap, so the wide eyes and hearts merge into one shape. Pupils 4 pixels apart keep them apart.')
})

test('a form for a mode that does not exist, or one that is not an object, is left out with a note; a form with no sprite reads as the base', () => {
  const read = readTheme({ ...BASE, forms: { flying: { palette: { a: '#ffffff' } }, bash: 'red', idle: {} } })
  if (read.errors) {
    throw new Error(read.errors.join('\n'))
  }
  expect(Object.keys(read.theme.forms)).toEqual(['idle'])
  expect(read.notes).toEqual(['"flying" in `forms` is not a mode, so it is left out.', '`forms.bash` is not an object of sprite fields, so it is left out.'])
  const listed = readTheme({ ...BASE, forms: [] })
  expect(listed.errors ? listed.errors : listed.notes).toContain('`forms` maps a mode to its form, so it is left out.')
})

test('a theme kept before forms existed reads with none', () => {
  const read = readTheme(BASE)
  expect(read.errors).toBeUndefined()
  expect(read.errors ? undefined : read.theme.forms).toEqual({})
})
