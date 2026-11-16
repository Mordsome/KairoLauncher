import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addonRelease, fakeAddonJar, sha256, withSums } from '../helpers/addonRelease'

// The addons catalogue and installs (SPEC.md section 5), against a fake
// GitHub: every tampering case must be refused.

// The long form of the temp folder: Windows runners hand out a short 8.3 one (RUNNER~1),
// and the launcher's data folder is always resolved to the long form.
const data = realpathSync.native(mkdtempSync(join(tmpdir(), 'kairo-addons-')))
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', getPath: () => data, isPackaged: false } }))

const LIST = 'https://api.github.com/repos/Mordsome/KairoAddons/releases?per_page=10'
const DL = 'https://github.com/Mordsome/KairoAddons/releases/download/'

type Release = { tag: string; files: Record<string, Buffer>; draft?: boolean; prerelease?: boolean; prefix?: string }
const net: { releases: Release[] | 'missing' | 'down' } = { releases: 'missing' }

function urlFor(r: Release, name: string) {
  return `${r.prefix ?? DL}${r.tag}/${name}`
}
function served(url: string): Buffer | null {
  if (!Array.isArray(net.releases)) return null
  for (const r of net.releases) for (const [name, b] of Object.entries(r.files)) if (urlFor(r, name) === url) return b
  return null
}

vi.mock('../../src/main/net/http', () => ({
  httpFetch: vi.fn(async (url: string) => {
    if (net.releases === 'down') throw new Error('offline')
    if (url !== LIST) throw new Error(`unexpected ${url}`)
    if (net.releases === 'missing') return new Response('{"message":"Not Found"}', { status: 404 })
    const body = net.releases.map((r) => ({
      tag_name: r.tag,
      draft: !!r.draft,
      prerelease: !!r.prerelease,
      assets: Object.keys(r.files).map((name) => ({ name, browser_download_url: urlFor(r, name) }))
    }))
    return new Response(JSON.stringify(body), { status: 200 })
  }),
  fetchOk: vi.fn(async (url: string) => {
    if (net.releases === 'down') throw new Error('offline')
    const b = served(url)
    if (!b) throw new Error(`404 ${url}`)
    return new Response(new Uint8Array(b))
  }),
  fetchJson: vi.fn(async () => {
    throw new Error('no network in this test')
  })
}))

const { addonCatalogue, parseCatalogue } = await import('../../src/main/addons/catalogue')
const { addonsForLaunch, addonsState, installAddon, plainRange, setAddonChoice, uninstallAddon, whyNot } = await import('../../src/main/addons/addons')
const { parseSha256Sums } = await import('../../src/main/kairo/github')

const publish = (files: Record<string, Buffer>, extra: Partial<Release> = {}) => {
  net.releases = [{ tag: 'addons-1', files, ...extra }]
}
const catalogue = () => addonCatalogue(true)
const ids = async () => (await catalogue()).catalogue?.addons.map((a) => a.id) ?? null

beforeEach(() => {
  rmSync(join(data, 'cache'), { recursive: true, force: true })
  rmSync(join(data, 'addons'), { recursive: true, force: true })
  rmSync(join(data, 'addons.json'), { force: true })
  net.releases = 'missing'
})

describe('the catalogue', () => {
  it('no repository yet means "no addons", not an error', async () => {
    expect(await catalogue()).toEqual({ status: 'none', catalogue: null })
    expect((await addonsState(true)).catalogue).toBe('none')
  })

  it('reads a good release, icons included, and uses it again when GitHub is down', async () => {
    publish(addonRelease([{ id: 'plastic-menus', icon: true }, { id: 'second-one' }]))
    const r = await catalogue()
    expect(r.status).toBe('ok')
    expect(r.catalogue?.addons.map((a) => [a.id, !!a.icon])).toEqual([
      ['plastic-menus', true],
      ['second-one', false]
    ])
    net.releases = 'down'
    expect(await ids()).toEqual(['plastic-menus', 'second-one'])
  })

  it('GitHub down with nothing from before: "can\'t be reached"', async () => {
    net.releases = 'down'
    expect((await catalogue()).status).toBe('offline')
  })

  it('refuses an addons.json that doesn\'t match SHA256SUMS.txt', async () => {
    const files = addonRelease([{ id: 'plastic-menus' }])
    files['addons.json'] = Buffer.from(files['addons.json']!.toString().replace('Summary', 'Changed'))
    publish(files)
    expect((await catalogue()).status).toBe('none')
  })

  it('leaves out an addon whose jar hash differs from SHA256SUMS.txt', async () => {
    const files = addonRelease([{ id: 'plastic-menus' }, { id: 'good-one' }])
    files['kairo-addon-plastic-menus-1.0.0.jar'] = fakeAddonJar('plastic-menus', '1.0.0', 'something-else')
    // SHA256SUMS.txt is made for the new jar, but addons.json still names the old hash.
    const sums = parseSha256Sums(withSums(files)['SHA256SUMS.txt']!.toString())
    const json = JSON.parse(files['addons.json']!.toString())
    expect(sums.get('kairo-addon-plastic-menus-1.0.0.jar')).not.toBe(json.addons[0].sha256)
    publish(withSums(files))
    expect(await ids()).toEqual(['good-one'])
  })

  it('accepts only addon ids and file names of the right shape', () => {
    const jar = fakeAddonJar('x', '1.0.0')
    const entry = (over: Record<string, unknown>) => ({
      id: 'plastic-menus', name: 'P', summary: 'S', version: '1.0.0', file: 'kairo-addon-plastic-menus-1.0.0.jar',
      sha256: sha256(jar), size: jar.length, editions: ['kairo'], api: 1, kairo: '>=0.3.0', minecraft: '~26.3', ...over
    })
    const sums = (name: string) => new Map([[name, sha256(jar)]])
    const ok = parseCatalogue({ schema: 1, addons: [entry({})] }, sums('kairo-addon-plastic-menus-1.0.0.jar'))
    expect(ok?.map((a) => a.id)).toEqual(['plastic-menus'])
    for (const [over, name] of [
      [{ file: '../evil.jar' }, '../evil.jar'],
      [{ file: 'kairo-addon-plastic-menus-1.0.0.jar/../../x' }, 'kairo-addon-plastic-menus-1.0.0.jar/../../x'],
      [{ file: 'kairo-addon-other-1.0.0.jar' }, 'kairo-addon-other-1.0.0.jar'],
      [{ id: 'Plastic', file: 'kairo-addon-Plastic-1.0.0.jar' }, 'kairo-addon-Plastic-1.0.0.jar'],
      [{ id: 'a'.repeat(41), file: `kairo-addon-${'a'.repeat(41)}-1.0.0.jar` }, `kairo-addon-${'a'.repeat(41)}-1.0.0.jar`],
      [{ version: '1.0', file: 'kairo-addon-plastic-menus-1.0.jar' }, 'kairo-addon-plastic-menus-1.0.jar'],
      [{ editions: ['lite'] }, 'kairo-addon-plastic-menus-1.0.0.jar'],
      [{ api: '1' }, 'kairo-addon-plastic-menus-1.0.0.jar'],
      [{ kairo: '>=0.3.0; rm -rf' }, 'kairo-addon-plastic-menus-1.0.0.jar'],
      [{ name: 'x'.repeat(61) }, 'kairo-addon-plastic-menus-1.0.0.jar'],
      [{ size: 999_999_999 }, 'kairo-addon-plastic-menus-1.0.0.jar']
    ] as const) {
      expect(parseCatalogue({ schema: 1, addons: [entry(over)] }, sums(name)), JSON.stringify(over)).toEqual([])
    }
    // Another schema is "no catalogue"; unknown fields are fine.
    expect(parseCatalogue({ schema: 2, addons: [entry({})] }, sums('kairo-addon-plastic-menus-1.0.0.jar'))).toBeNull()
    expect(parseCatalogue({ schema: 1, addons: [entry({ later: { x: 1 } })] }, sums('kairo-addon-plastic-menus-1.0.0.jar'))).toHaveLength(1)
  })

  it('skips drafts, pre-releases, other tags, bad signatures and downloads from anywhere else', async () => {
    const files = addonRelease([{ id: 'plastic-menus' }])
    for (const extra of [{ draft: true }, { prerelease: true }, { tag: 'v0.3.0' }, { prefix: 'https://github.com/Someone/KairoAddons/releases/download/' }]) {
      publish(files, extra)
      expect((await catalogue()).status, JSON.stringify(extra)).toBe('none')
    }
    publish({ ...files, 'SHA256SUMS.txt.sig': Buffer.from('bm90IGEgc2lnbmF0dXJl') })
    expect((await catalogue()).status).toBe('none')
    // An older good release still counts.
    net.releases = [
      { tag: 'addons-2', files, draft: true },
      { tag: 'addons-1', files }
    ]
    expect(await ids()).toEqual(['plastic-menus'])
  })
})

describe('installing, choosing, launching', () => {
  const mods = join(data, 'install-mods')

  it('installs (checked), is on for both editions, and loads only where it fits', async () => {
    publish(addonRelease([{ id: 'plastic-menus' }]))
    await installAddon('plastic-menus')
    expect(readdirSync(join(data, 'addons'))).toEqual(['kairo-addon-plastic-menus-1.0.0.jar'])
    const state = JSON.parse(readFileSync(join(data, 'addons.json'), 'utf8'))
    expect(state.addons['plastic-menus']).toMatchObject({ version: '1.0.0', kairo: true, void: true })

    const jar = join(data, 'addons', 'kairo-addon-plastic-menus-1.0.0.jar')
    expect(await addonsForLaunch('kairo', '0.3.0+26.3', '26.3', mods, false)).toEqual({ jars: [jar], notes: [] })
    // Not compatible: skipped with a reason, never an error.
    const old = await addonsForLaunch('void', '0.2.0', '26.3', mods, false)
    expect(old.jars).toEqual([])
    expect(old.notes).toEqual(['plastic-menus isn\'t loaded: it needs Kairo 0.3.0 or newer (this install has 0.2.0).'])

    // Kairo only: nothing for Kairo Void.
    await setAddonChoice('plastic-menus', 'kairo')
    expect((await addonsForLaunch('void', '0.3.0', '26.3', mods, false)).jars).toEqual([])
    expect((await addonsForLaunch('kairo', '0.3.0', '26.3', mods, false)).jars).toEqual([jar])
    await setAddonChoice('plastic-menus', 'off')
    expect((await addonsForLaunch('kairo', '0.3.0', '26.3', mods, false)).jars).toEqual([])
    await setAddonChoice('plastic-menus', 'both')

    // A copy the player put in mods/ by hand: the launcher's isn't passed too.
    mkdirSync(mods, { recursive: true })
    copyFileSync(jar, join(mods, 'my-copy.jar'))
    expect((await addonsForLaunch('kairo', '0.3.0', '26.3', mods, false)).jars).toEqual([])
    rmSync(mods, { recursive: true, force: true })

    // A damaged jar is never passed.
    writeFileSync(jar, 'damaged')
    expect((await addonsForLaunch('kairo', '0.3.0', '26.3', mods, false)).notes[0]).toMatch(/missing or damaged/)

    await uninstallAddon('plastic-menus')
    expect(readdirSync(join(data, 'addons'))).toEqual([])
    expect(JSON.parse(readFileSync(join(data, 'addons.json'), 'utf8')).addons).toEqual({})
  })

  it('refuses a jar that doesn\'t match its hash, or isn\'t the addon it says', async () => {
    const files = addonRelease([{ id: 'plastic-menus' }, { id: 'impostor' }])
    publish({ ...files, 'kairo-addon-plastic-menus-1.0.0.jar': fakeAddonJar('plastic-menus', '1.0.0', 'tampered') })
    await expect(installAddon('plastic-menus')).rejects.toThrow(/checksum/)

    // Hashes all agree, but the jar inside is a different mod.
    const swapped: Record<string, Buffer> = { ...files, 'kairo-addon-impostor-1.0.0.jar': fakeAddonJar('impostor', '1.0.0', 'kairo-addon-plastic-menus') }
    const json = JSON.parse(swapped['addons.json']!.toString())
    json.addons[1].sha256 = sha256(swapped['kairo-addon-impostor-1.0.0.jar']!)
    json.addons[1].size = swapped['kairo-addon-impostor-1.0.0.jar']!.length
    publish(withSums({ ...swapped, 'addons.json': Buffer.from(JSON.stringify(json)) }))
    await expect(installAddon('impostor')).rejects.toThrow(/isn't the addon it says/)
    expect(existsSync(join(data, 'addons')) ? readdirSync(join(data, 'addons')) : []).toEqual([])
  })

  it('offers only choices the addon is made for', async () => {
    publish(addonRelease([{ id: 'kairo-only', editions: ['kairo'] }]))
    await installAddon('kairo-only')
    await expect(setAddonChoice('kairo-only', 'void')).rejects.toThrow(/isn't made for that/)
    await expect(setAddonChoice('kairo-only', 'both')).rejects.toThrow()
    expect((await addonsForLaunch('void', '0.3.0', '26.3', mods, false)).jars).toEqual([])
  })

  it('updates: the new jar is checked first, then the old one goes; the choice stays', async () => {
    publish(addonRelease([{ id: 'plastic-menus' }]))
    await installAddon('plastic-menus')
    await setAddonChoice('plastic-menus', 'void')
    publish(addonRelease([{ id: 'plastic-menus', version: '1.1.0' }]))
    expect((await addonsState(true)).addons[0]).toMatchObject({ installed: '1.0.0', update: '1.1.0', choice: 'void' })
    // With "Keep Kairo updated", playing updates it.
    const run = await addonsForLaunch('void', '0.3.0', '26.3', mods, true)
    expect(run.jars).toEqual([join(data, 'addons', 'kairo-addon-plastic-menus-1.1.0.jar')])
    expect(readdirSync(join(data, 'addons'))).toEqual(['kairo-addon-plastic-menus-1.1.0.jar'])
    expect((await addonsState()).addons[0]).toMatchObject({ installed: '1.1.0', update: null, choice: 'void' })
  })

  it('an addon that left the catalogue stays installed and usable', async () => {
    publish(addonRelease([{ id: 'plastic-menus' }]))
    await installAddon('plastic-menus')
    publish(addonRelease([{ id: 'something-else' }]))
    const state = await addonsState(true)
    expect(state.addons.find((a) => a.id === 'plastic-menus')).toMatchObject({ installed: '1.0.0', listed: false })
    expect((await addonsForLaunch('kairo', '0.3.0', '26.3', mods, false)).jars).toHaveLength(1)
  })

  it('says why in plain words', () => {
    expect(plainRange('>=0.3.0')).toBe('0.3.0 or newer')
    expect(plainRange('~26.3')).toBe('26.3')
    const needs = { editions: ['kairo' as const], api: 1, needs: { kairo: '>=0.3.0', minecraft: '~26.3' } }
    expect(whyNot(needs, 'void', '0.3.0', '26.3')).toBe('is made for Kairo only')
    expect(whyNot(needs, 'kairo', '0.3.0', '26.4')).toBe('needs Minecraft 26.3 (this install has 26.4)')
    expect(whyNot({ ...needs, api: 2 }, 'kairo', '0.3.0', '26.3')).toMatch(/newer Kairo/)
    expect(whyNot(needs, 'kairo', '0.3.1+26.3', '26.3')).toBeNull()
  })
})

describe('groups', () => {
  it('lists Themes, Effects, Fun, Tools, Other in that order, hides empty ones, and puts unknown or missing groups under Other', async () => {
    const { groupAddons } = await import('../../src/renderer/src/state/addonGroups')
    const list = [
      { id: 'a', group: 'tools' },
      { id: 'b', group: 'themes' },
      { id: 'c', group: 'seasonal' },
      { id: 'd' },
      { id: 'e', group: 'themes' },
      { id: 'f', group: null }
    ]
    expect(groupAddons(list).map((g) => [g.group.name, g.addons.map((a) => a.id)])).toEqual([
      ['Themes', ['b', 'e']],
      ['Tools', ['a']],
      ['Other', ['c', 'd', 'f']]
    ])
    expect(groupAddons([])).toEqual([])
  })

  it('reads the group from the catalogue; an unknown one is "other", never an error', async () => {
    publish(addonRelease([{ id: 'one', group: 'effects' }, { id: 'two', group: 'seasonal' }, { id: 'three' }]))
    const r = await catalogue()
    expect(r.catalogue?.addons.map((a) => [a.id, a.group])).toEqual([
      ['one', 'effects'],
      ['two', 'other'],
      ['three', 'other']
    ])
    expect((await addonsState()).addons.map((a) => a.group)).toEqual(['effects', 'other', 'other'])
  })
})

describe('clashes', () => {
  it('count both ways, and only where the editions meet', async () => {
    const { clash, clashEditions } = await import('../../src/main/addons/addons')
    const a = { id: 'kairo-98', conflicts: ['plastic-menus'] }
    const b = { id: 'plastic-menus', conflicts: [] }
    const c = { id: 'command-bar', conflicts: [] }
    expect(clash(a, b)).toBe(true)
    expect(clash(b, a)).toBe(true)
    expect(clash(b, c)).toBe(false)
    expect(clashEditions(a, ['kairo', 'void'], b, ['void'])).toEqual(['void'])
    expect(clashEditions(b, ['kairo'], a, ['void'])).toEqual([])
    expect(clashEditions(b, ['kairo'], c, ['kairo'])).toEqual([])
  })

  it('reads conflicts from the catalogue, never naming itself or anything that isn\'t an id', async () => {
    publish(addonRelease([{ id: 'kairo-98', conflicts: ['plastic-menus', 'kairo-98', '../x', 'command-bar', 'plastic-menus'] }, { id: 'plastic-menus' }]))
    expect((await catalogue()).catalogue?.addons[0]?.conflicts).toEqual(['plastic-menus', 'command-bar'])
    const view = (await addonsState()).addons
    // Shown on both addons' pages, whichever one says it.
    expect(view.map((a) => [a.id, a.clashes.map((c) => c.name)])).toEqual([
      ['kairo-98', ['plastic-menus']],
      ['plastic-menus', ['kairo-98']]
    ])
  })

  it('turning one on asks which to keep; keeping it turns the other off only where they meet', async () => {
    publish(addonRelease([{ id: 'kairo-98', conflicts: ['plastic-menus'] }, { id: 'plastic-menus' }]))
    await installAddon('plastic-menus')
    // Installing a clashing addon: it stays off where the other is on, and the clash comes back.
    const onInstall = await installAddon('kairo-98')
    expect(onInstall).toMatchObject({ id: 'kairo-98', otherId: 'plastic-menus', editions: ['kairo', 'void'], choice: 'both' })
    const choices = () => addonsState().then((s) => Object.fromEntries(s.addons.map((a) => [a.id, a.choice])))
    expect(await choices()).toEqual({ 'kairo-98': 'off', 'plastic-menus': 'both' })

    // Asking again without a decision changes nothing.
    expect(await setAddonChoice('kairo-98', 'void')).toMatchObject({ editions: ['void'] })
    expect(await choices()).toEqual({ 'kairo-98': 'off', 'plastic-menus': 'both' })
    // Keep the other one: nothing changes.
    expect(await setAddonChoice('kairo-98', 'void', 'other')).toBeNull()
    expect(await choices()).toEqual({ 'kairo-98': 'off', 'plastic-menus': 'both' })
    // Keep this one: the other is turned off in Kairo Void only.
    expect(await setAddonChoice('kairo-98', 'void', 'this')).toBeNull()
    expect(await choices()).toEqual({ 'kairo-98': 'void', 'plastic-menus': 'kairo' })
    // Editions that don't meet don't clash.
    expect(await setAddonChoice('plastic-menus', 'kairo')).toBeNull()

    // And Play never loads both, whatever the state file says.
    const file = join(data, 'addons.json')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.addons['plastic-menus'].void = true
    writeFileSync(file, JSON.stringify(raw))
    const run = await addonsForLaunch('void', '0.3.0', '26.3', join(data, 'no-mods'), false)
    expect(run.jars).toHaveLength(1)
    expect(run.notes[0]).toMatch(/doesn't go together with/)
  })
})
