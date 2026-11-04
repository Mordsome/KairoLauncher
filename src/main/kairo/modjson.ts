import { filterEntries, open, readEntry } from '@xmcl/unzip'

export interface FabricModJson {
  id: string
  version: string
  name?: string
  depends?: Record<string, string | string[]>
}

/** Reads fabric.mod.json from a mod jar. */
export async function readFabricModJson(jar: string): Promise<FabricModJson> {
  const zip = await open(jar, { lazyEntries: true, autoClose: false })
  try {
    const [entry] = await filterEntries(zip, ['fabric.mod.json'])
    if (!entry) throw new Error(`${jar} has no fabric.mod.json`)
    const json = JSON.parse((await readEntry(zip, entry)).toString('utf8')) as FabricModJson
    if (typeof json.id !== 'string' || typeof json.version !== 'string') throw new Error('fabric.mod.json is missing id or version')
    return json
  } finally {
    zip.close()
  }
}
