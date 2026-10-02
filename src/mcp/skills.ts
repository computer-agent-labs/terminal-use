import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, extname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

import {ProtocolError, ProtocolErrorCode, type McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod'

/**
 * Agent Skills served over MCP (the `io.modelcontextprotocol/skills`
 * extension, SEP-2640). A skill is a directory with a SKILL.md and optional
 * supporting files; hosts list them with `skills/list`, look one up with
 * `skills/get`, and read the files through ordinary `resources/read`.
 *
 * The same directories under skills/ are plain Agent Skills on disk, so a
 * host without this extension can still be pointed at them as files.
 */
export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'

export type Frontmatter = {name: string; description: string} & Record<string, unknown>

export interface SkillFile {
  uri: string
  /** `sha256:` + 64 lowercase hex characters, over the raw bytes. */
  digest: string
  size: number
  mimeType: string
  bytes: Buffer
}

export interface Skill {
  /** URI of the skill's SKILL.md. */
  uri: string
  frontmatter: Frontmatter
  files: SkillFile[]
}

// The files ship with the package and cannot change under a running server,
// so hosts may cache the listing for a long time and share it.
const CACHE = {ttlMs: 60 * 60 * 1000, cacheScope: 'public' as const}

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.sh': 'application/x-sh',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

/** skills/ sits next to src/ in the repository and next to dist/ in the published package. */
export function defaultSkillsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')
}

/**
 * Parse the YAML frontmatter of a SKILL.md. Skill frontmatter is a flat map
 * of scalars plus, at most, one level of nested maps (`metadata:`), which is
 * all this handles — enough for the Agent Skills format without pulling in
 * a YAML library.
 */
export function parseFrontmatter(markdown: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)
  if (!m) throw new Error('SKILL.md must begin with YAML frontmatter delimited by "---" lines')
  const out: Record<string, unknown> = {}
  let nested: Record<string, unknown> | undefined
  for (const raw of m[1]!.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    const indented = /^\s/.test(raw)
    const pair = /^\s*([^:#\s][^:]*?):(?:\s+(.*)|\s*)$/.exec(raw)
    if (!pair) throw new Error(`Unsupported frontmatter line: ${JSON.stringify(raw)}`)
    const key = pair[1]!
    const value = pair[2] === undefined ? undefined : scalar(pair[2])
    if (indented) {
      if (!nested) throw new Error(`Unexpected indentation in frontmatter: ${JSON.stringify(raw)}`)
      nested[key] = value ?? ''
    } else if (value === undefined) {
      nested = {}
      out[key] = nested
    } else {
      nested = undefined
      out[key] = value
    }
  }
  return out
}

function scalar(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.startsWith('"') ? (JSON.parse(t) as string) : t.slice(1, -1).replaceAll("''", "'")
  }
  return t
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

/** Load every skill directory under `root`. A missing directory simply means no skills. */
export function loadSkills(root = defaultSkillsDir()): Skill[] {
  if (!existsSync(root)) return []
  const skills: Skill[] = []
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name)
    const main = join(dir, 'SKILL.md')
    if (!statSync(dir).isDirectory() || !existsSync(main)) continue
    const frontmatter = parseFrontmatter(readFileSync(main, 'utf8'))
    if (typeof frontmatter.name !== 'string' || typeof frontmatter.description !== 'string') {
      throw new Error(`${main}: frontmatter needs a string \`name\` and \`description\``)
    }
    if (frontmatter.name !== name) {
      throw new Error(`${main}: frontmatter name "${frontmatter.name}" must match its directory "${name}"`)
    }
    const files = walk(dir).map(path => {
      const bytes = readFileSync(path)
      return {
        uri: `skill://${name}/${relative(dir, path).split(sep).map(encodeURIComponent).join('/')}`,
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        size: bytes.length,
        mimeType: MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        bytes
      }
    })
    skills.push({uri: `skill://${name}/SKILL.md`, frontmatter: frontmatter as Frontmatter, files})
  }
  return skills
}

function entry(skill: Skill) {
  return {
    uri: skill.uri,
    frontmatter: skill.frontmatter,
    resources: skill.files.map(({uri, digest, size}) => ({uri, digest, size}))
  }
}

const isText = (mimeType: string) =>
  mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/yaml'

/**
 * Serve `skills` from `server`: each file as a resource, plus the two
 * extension methods. The server must have been constructed with the
 * `resources` capability and the skills extension declared.
 */
export function registerSkills(server: McpServer, skills: Skill[]): void {
  for (const skill of skills) {
    for (const file of skill.files) {
      const isMain = file.uri === skill.uri
      const path = file.uri.slice(`skill://${skill.frontmatter.name}/`.length)
      server.registerResource(
        isMain ? skill.frontmatter.name : `${skill.frontmatter.name}/${decodeURIComponent(path)}`,
        file.uri,
        {
          description: isMain
            ? skill.frontmatter.description
            : `Supporting file of the "${skill.frontmatter.name}" skill.`,
          mimeType: file.mimeType,
          cacheHint: CACHE
        },
        () => ({
          contents: [
            isText(file.mimeType)
              ? {uri: file.uri, mimeType: file.mimeType, text: file.bytes.toString('utf8')}
              : {uri: file.uri, mimeType: file.mimeType, blob: file.bytes.toString('base64')}
          ]
        })
      )
    }
  }

  // Not spec methods the SDK knows, so registered by name with their own
  // schemas. The listing is small: one page, no cursor ever handed out.
  server.server.setRequestHandler(
    'skills/list',
    {params: z.object({cursor: z.string().optional()}).loose().optional()},
    () => ({resultType: 'complete', skills: skills.map(entry), ...CACHE})
  )
  server.server.setRequestHandler('skills/get', {params: z.object({uri: z.string()}).loose()}, params => {
    const skill = skills.find(s => s.uri === params.uri)
    if (!skill) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown skill: ${params.uri}`)
    }
    return {resultType: 'complete', skill: entry(skill), ...CACHE}
  })
}
