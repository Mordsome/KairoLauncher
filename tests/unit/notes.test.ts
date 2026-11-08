import { describe, expect, it } from 'vitest'
import { notePoints } from '../../src/main/kairo/notes'

describe('patch notes', () => {
  it('takes the bullet points, as plain text', () => {
    const body = [
      '## Kairo 0.21',
      '',
      '- **New:** a [minimap](https://example.com) in the HUD',
      '* Faster `menu` blur',
      '+ Fixed _flicker_ in Void',
      '1. Keeps snake_case_names intact',
      '- Fifth point is left out'
    ].join('\n')
    expect(notePoints(body)).toEqual(['New: a minimap in the HUD', 'Faster menu blur', 'Fixed flicker in Void', 'Keeps snake_case_names intact'])
  })

  it('prefers the "New in" or "Highlights" section over other bullets', () => {
    const body = [
      '# Kairo 0.2.0',
      '',
      'Your wallpaper colours and a better CPS.',
      '',
      '- **`kairo-0.2.0.jar`**: Kairo Client.',
      '- **`kairo-void-0.2.0.jar`**: Kairo Void.',
      '## New in 0.2.0',
      '- **Wallpaper colours.** Like Material You.',
      '- **CPS label.** Change the word after your CPS.',
      '## Install',
      '- Fabric API for 26.3'
    ].join('\n')
    expect(notePoints(body)).toEqual(['Wallpaper colours. Like Material You.', 'CPS label. Change the word after your CPS.'])
    expect(notePoints(body.replace('## New in 0.2.0', '## Highlights'))).toHaveLength(2)
  })

  it('joins a bullet with the lines it wraps onto', () => {
    expect(notePoints('## New\n- **Colours.** Set any image as your\n  background and Kairo picks colours.\n- Next')).toEqual([
      'Colours. Set any image as your background and Kairo picks colours.',
      'Next'
    ])
  })

  it('without such a section, uses the opening sentence instead of the first bullets', () => {
    expect(notePoints('# Kairo 0.2.0\n\nYour wallpaper colours.\n\n- **`kairo-0.2.0.jar`**: Kairo Client.')).toEqual(['Your wallpaper colours.'])
  })

  it("tidies GitHub's generated notes", () => {
    const body = "## What's Changed\n* Add item physics by @Mordsome in https://github.com/Mordsome/Kairo/pull/12\n\n**Full Changelog**: https://github.com/Mordsome/Kairo/compare/v0.20...v0.21"
    expect(notePoints(body)).toEqual(['Add item physics'])
  })

  it('never passes HTML or images through', () => {
    expect(notePoints('- <img src=x onerror=alert(1)>Safe ![pic](https://x/y.png) text')).toEqual(['Safe text'])
  })

  it('uses the first line of text when there are no bullets, and shortens long points', () => {
    expect(notePoints('# Title\n\nSmoother menus and a calmer HUD.\n\nMore below.')).toEqual(['Smoother menus and a calmer HUD.'])
    const long = notePoints(`- ${'word '.repeat(60)}`)[0]!
    expect(long.length).toBeLessThanOrEqual(140)
    expect(long.endsWith('…')).toBe(true)
  })

  it('is empty for an empty description', () => {
    expect(notePoints('')).toEqual([])
    expect(notePoints(null)).toEqual([])
    expect(notePoints('## Only a heading')).toEqual([])
  })
})
