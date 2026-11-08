import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => '', isPackaged: false } }))

const { coloursFor, fieldColours, KAIRO_LOOK, lookVars, shownAccent, VOID_LOOK } = await import('../../src/renderer/src/state/look')
const { isLook } = await import('../../src/main/installs/custom')

describe('install looks', () => {
  it('keeps the hand-tuned Kairo and Void palettes', () => {
    expect(coloursFor(KAIRO_LOOK.accent)['--bg']).toBe('#0a1322')
    expect(coloursFor(VOID_LOOK.accent)['--bg']).toBe('#130a2a')
    expect(lookVars(VOID_LOOK)['--r-card']).toBe('6px')
    expect(lookVars(KAIRO_LOOK)['--r-full']).toBe('40px')
  })

  it('works out a full palette for any other accent', () => {
    const c = coloursFor('#6ee7b7')
    expect(c['--accent']).toBe('rgb(110, 231, 183)')
    for (const v of Object.values(c)) expect(v).toMatch(/^(rgba?\(|#)/)
    // The background stays dark whatever the accent.
    const bg = c['--bg']!.match(/\d+/g)!.map(Number)
    expect(Math.max(...bg)).toBeLessThan(40)
  })

  it('keeps accents readable: too dark or too light is adjusted', () => {
    expect(shownAccent('#7fd8ff')).toBe('#7fd8ff')
    const dark = shownAccent('#102030')
    const light = shownAccent('#ffffff')
    expect(dark).not.toBe('#102030')
    expect(light).not.toBe('#ffffff')
    expect(shownAccent('not a colour')).toBe(KAIRO_LOOK.accent)
  })

  it('gives the Pixel field the accent and hot colours', () => {
    expect(fieldColours(KAIRO_LOOK)).toEqual({ accent: [127, 216, 255], hot: [255, 154, 82] })
    expect(fieldColours(VOID_LOOK)).toEqual({ accent: [180, 140, 255], hot: [255, 110, 199] })
  })

  it('stores only a colour and a rounding', () => {
    expect(isLook({ accent: '#AbCdEf', rounding: 'soft' })).toBe(true)
    expect(isLook({ accent: 'red', rounding: 'soft' })).toBe(false)
    expect(isLook({ accent: '#abcdef; x', rounding: 'soft' })).toBe(false)
    expect(isLook({ accent: '#abcdef', rounding: 'pill' })).toBe(false)
    expect(isLook(null)).toBe(false)
  })
})
