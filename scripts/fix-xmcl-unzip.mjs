// @xmcl/unzip 2.2.0 was published with "main": "./index.ts", a file it doesn't
// ship; its built code is in dist/. Point the package at that after install.
// Does nothing once upstream publishes a fixed version.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const pkgPath = new URL('../node_modules/@xmcl/unzip/package.json', import.meta.url)
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.main === './index.ts' && existsSync(new URL('../node_modules/@xmcl/unzip/dist/index.js', import.meta.url))) {
    Object.assign(pkg, { main: './dist/index.js', module: './dist/index.mjs', types: './dist/index.d.ts' })
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log('Fixed @xmcl/unzip package entry.')
  }
}
