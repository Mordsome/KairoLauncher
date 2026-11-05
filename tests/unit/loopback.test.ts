import { describe, expect, it } from 'vitest'
import { startLoopback } from '../../src/main/auth/loopback'

const get = (url: string) => fetch(url).then((r) => r.status)
const v4 = (uri: string) => uri.replace('localhost', '127.0.0.1')

describe('sign-in redirect listener', () => {
  it('listens on localhost and ignores requests without the right state', async () => {
    const loop = await startLoopback()
    expect(loop.redirectUri).toMatch(/^http:\/\/localhost:\d+$/)
    const code = loop.waitForCode('right-state', new AbortController().signal)
    expect(await get(`${v4(loop.redirectUri)}/?code=evil&state=wrong`)).toBe(400)
    expect(await get(`${v4(loop.redirectUri)}/favicon.ico`)).toBe(404)
    expect(await get(`${v4(loop.redirectUri)}/?code=good&state=right-state`)).toBe(200)
    await expect(code).resolves.toBe('good')
  })

  it('turns "access denied" into a cancelled sign-in', async () => {
    const loop = await startLoopback()
    const outcome = loop.waitForCode('s', new AbortController().signal).catch((e: unknown) => e)
    await get(`${v4(loop.redirectUri)}/?error=access_denied&state=s`)
    expect(await outcome).toMatchObject({ code: 'cancelled' })
  })

  it('Cancel in the launcher stops waiting and closes the port', async () => {
    const loop = await startLoopback()
    const controller = new AbortController()
    const code = loop.waitForCode('s', controller.signal)
    controller.abort()
    await expect(code).rejects.toMatchObject({ code: 'cancelled' })
    await new Promise((r) => setTimeout(r, 700))
    await expect(get(`${v4(loop.redirectUri)}/?code=x&state=s`)).rejects.toThrow()
  })
})
