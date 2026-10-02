import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, describe, expect, it} from 'vitest'
import {z} from 'zod'

import {defaultSkillsDir, loadSkills, parseFrontmatter, SKILLS_EXTENSION} from '../../src/mcp/skills.js'

import {startServer, type ServerHarness} from './helpers.js'

const SkillEntry = z.object({
  uri: z.string(),
  frontmatter: z.object({name: z.string(), description: z.string()}).loose(),
  resources: z.array(z.object({uri: z.string(), digest: z.string(), size: z.number()}))
})
const Cacheable = {ttlMs: z.number(), cacheScope: z.enum(['public', 'private'])}
const ListResult = z.object({skills: z.array(SkillEntry), ...Cacheable})
const GetResult = z.object({skill: SkillEntry, ...Cacheable})

let harness: ServerHarness | undefined

afterEach(async () => {
  await harness?.shutdown()
  harness = undefined
})

describe('skills over MCP', () => {
  it('declares the extension alongside the resources capability', async () => {
    harness = await startServer({}, 'modern')
    const caps = harness.client.getServerCapabilities()
    expect(caps?.resources).toBeDefined()
    expect(caps?.extensions?.[SKILLS_EXTENSION]).toEqual({})
  })

  it('lists the terminal-use skill with a complete manifest that matches the bytes served', async () => {
    harness = await startServer({}, 'modern')
    const {skills} = await harness.client.request({method: 'skills/list', params: {}}, ListResult)
    expect(skills.map(s => s.uri)).toEqual(['skill://terminal-use/SKILL.md'])
    const skill = skills[0]!
    expect(skill.frontmatter.name).toBe('terminal-use')
    expect(skill.resources.map(r => r.uri)).toEqual(
      expect.arrayContaining([
        'skill://terminal-use/SKILL.md',
        'skill://terminal-use/references/keys.md',
        'skill://terminal-use/references/recipes.md',
        'skill://terminal-use/references/troubleshooting.md'
      ])
    )
    for (const file of skill.resources) {
      const read = await harness.client.readResource({uri: file.uri})
      const content = read.contents[0] as {uri: string; mimeType?: string; text: string}
      const bytes = Buffer.from(content.text, 'utf8')
      expect(content.uri).toBe(file.uri)
      expect(content.mimeType).toBe('text/markdown')
      expect(bytes.length, file.uri).toBe(file.size)
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, file.uri).toBe(file.digest)
    }
  })

  it('publishes frontmatter identical to what SKILL.md itself contains', async () => {
    harness = await startServer({}, 'modern')
    const {skills} = await harness.client.request({method: 'skills/list', params: {}}, ListResult)
    const read = await harness.client.readResource({uri: 'skill://terminal-use/SKILL.md'})
    const text = (read.contents[0] as {text: string}).text
    expect(skills[0]!.frontmatter).toEqual(parseFrontmatter(text))
  })

  it('looks a skill up by URI, and rejects an unknown one as invalid params', async () => {
    harness = await startServer({}, 'modern')
    const {skill} = await harness.client.request(
      {method: 'skills/get', params: {uri: 'skill://terminal-use/SKILL.md'}},
      GetResult
    )
    expect(skill.frontmatter.name).toBe('terminal-use')
    await expect(
      harness.client.request({method: 'skills/get', params: {uri: 'skill://nope/SKILL.md'}}, GetResult)
    ).rejects.toMatchObject({code: -32602})
    await expect(harness.client.readResource({uri: 'skill://terminal-use/missing.md'})).rejects.toMatchObject({
      code: -32602
    })
  })

  it('lists the skill files as ordinary resources, for hosts without the extension', async () => {
    harness = await startServer({}, 'legacy')
    const {resources} = await harness.client.listResources()
    const main = resources.find(r => r.uri === 'skill://terminal-use/SKILL.md')
    expect(main).toMatchObject({name: 'terminal-use', mimeType: 'text/markdown'})
    expect(main?.description).toMatch(/terminal-use MCP tools/)
  })
})

describe('the bundled skill', () => {
  const dir = join(defaultSkillsDir(), 'terminal-use')
  const main = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const fm = parseFrontmatter(main)

  it('meets the Agent Skills naming and size rules', () => {
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect((fm.name as string).length).toBeLessThanOrEqual(64)
    expect((fm.description as string).length).toBeLessThanOrEqual(1024)
    expect(main.split('\n').length).toBeLessThan(500)
  })

  it('only links to files that exist in the skill', () => {
    const files = loadSkills()[0]!.files.map(f => f.uri.replace('skill://terminal-use/', ''))
    const links = [...main.matchAll(/\]\(([^)#]+)\)/g)].map(m => m[1]!).filter(l => !/^[a-z]+:/.test(l))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(files, link).toContain(link)
  })

  it('names only tools the server actually has', async () => {
    harness = await startServer()
    const names = new Set((await harness.client.listTools()).tools.map(t => t.name))
    const all = loadSkills()[0]!.files.map(f => f.bytes.toString('utf8')).join('\n')
    const mentioned = new Set([...all.matchAll(/\bterminal_[a-z_]+\b/g)].map(m => m[0]))
    expect(mentioned.size).toBeGreaterThan(5)
    for (const tool of mentioned) expect(names, tool).toContain(tool)
  })
})

describe('loadSkills', () => {
  it('parses nested metadata and quoted values, and hashes every file', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-use-skills-'))
    try {
      mkdirSync(join(root, 'demo', 'references'), {recursive: true})
      writeFileSync(
        join(root, 'demo', 'SKILL.md'),
        '---\nname: demo\ndescription: "Does: things"\nmetadata:\n  version: "1.0"\n  author: someone\n---\n\n# Demo\n'
      )
      writeFileSync(join(root, 'demo', 'references', 'a.md'), 'hello\n')
      const [skill] = loadSkills(root)
      expect(skill!.frontmatter).toEqual({
        name: 'demo',
        description: 'Does: things',
        metadata: {version: '1.0', author: 'someone'}
      })
      expect(skill!.files.map(f => f.uri)).toEqual(['skill://demo/SKILL.md', 'skill://demo/references/a.md'])
      expect(skill!.files[1]).toMatchObject({
        size: 6,
        digest: 'sha256:5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03'
      })
    } finally {
      rmSync(root, {recursive: true, force: true})
    }
  })

  it('rejects a skill whose name does not match its directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-use-skills-'))
    try {
      mkdirSync(join(root, 'one'))
      writeFileSync(join(root, 'one', 'SKILL.md'), '---\nname: two\ndescription: x\n---\n')
      expect(() => loadSkills(root)).toThrow(/must match its directory/)
    } finally {
      rmSync(root, {recursive: true, force: true})
    }
  })

  it('returns nothing when there is no skills directory', () => {
    expect(loadSkills(join(tmpdir(), 'terminal-use-no-such-dir'))).toEqual([])
  })
})
