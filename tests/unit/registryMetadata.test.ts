import {readFileSync} from 'node:fs'

import {describe, expect, it} from 'vitest'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'))

// The MCP registry rejects a publish when these disagree, and nothing else
// would notice a version bump that only touched package.json.
describe('MCP registry metadata', () => {
  const pkg = read('package.json')
  const server = read('server.json')

  it('server.json names the same server as package.json mcpName', () => {
    expect(server.name).toBe(pkg.mcpName)
  })

  it('server.json points at this npm package and version', () => {
    expect(server.version).toBe(pkg.version)
    expect(server.packages).toHaveLength(1)
    expect(server.packages[0]).toMatchObject({registryType: 'npm', identifier: pkg.name, version: pkg.version})
  })

  it('keeps the description within the registry limit', () => {
    expect(server.description.length).toBeLessThanOrEqual(100)
  })

  it('declares the bin without a leading "./", which npm strips the whole entry for on publish', () => {
    // npm 11 "auto-corrects" `./bin/x.js` by removing the bin, and the
    // published package then has no command at all.
    for (const target of Object.values(pkg.bin as Record<string, string>)) {
      expect(target).not.toMatch(/^\.\//)
    }
    expect(Object.keys(pkg.bin)).toEqual([pkg.name])
  })
})
