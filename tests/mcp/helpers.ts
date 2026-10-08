import {mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {Client, InMemoryTransport} from '@modelcontextprotocol/client'
import {serveStdio} from '@modelcontextprotocol/server/stdio'

import {createTerminalUse, type CreateOptions} from '../../src/index.js'

/**
 * Which protocol era the test client speaks:
 *  - 'legacy': the 2025 initialize handshake (what most clients still send).
 *  - 'modern': the stateless 2026-07-28 revision, no handshake.
 */
export type Era = 'legacy' | 'modern'

export interface ServerHarness {
  client: Client
  shutdown: () => Promise<void>
}

export async function startServer(
  extra: Omit<CreateOptions, 'defaults'> = {},
  era: Era = 'legacy'
): Promise<ServerHarness> {
  // Pin to /bin/sh for deterministic prompts across machines. The user's
  // actual shell is exercised by the manual smoke script and the live MCP run.
  const terminalUse = createTerminalUse({
    // (On Windows there is no /bin/sh: take the product default, PowerShell.)
    defaults: {shell: process.platform === 'win32' ? undefined : '/bin/sh'},
    sweepIntervalMs: 0,
    ...extra
  })
  // Same entry the real binary uses, over an in-memory pipe instead of stdio.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const handle = serveStdio(terminalUse.buildServer, {transport: serverTransport})

  const client = new Client(
    {name: 'test-client', version: '1.0.0'},
    {capabilities: {}, versionNegotiation: era === 'modern' ? {mode: {pin: '2026-07-28'}} : undefined}
  )
  await client.connect(clientTransport)

  return {
    client,
    shutdown: async () => {
      await client.close()
      await handle.close()
      terminalUse.dispose()
    }
  }
}

// An empty HOME, so the shell below starts without the developer's own rc
// files: a slow prompt or custom key bindings would make timing and editing
// behave differently from one machine to the next.
const EMPTY_HOME = join(tmpdir(), 'terminal-use-test-empty-home')
mkdirSync(EMPTY_HOME, {recursive: true})

/**
 * terminal_create arguments for a shell with line editing (arrow keys move
 * within the command line). The default test shell, /bin/sh, is dash on
 * Debian and Ubuntu, which has none.
 */
export const EDITING_SHELL = {shell: '/bin/bash', env: {HOME: EMPTY_HOME}}

/** Convenience: create a session and return its numeric sessionId. */
export async function createSession(client: Client, opts: Record<string, unknown> = {}): Promise<number> {
  const r = await call(client, 'terminal_create', opts)
  if (r.isError) throw new Error(`terminal_create failed: ${r.text}`)
  const m = r.text.match(/Created session (\d+)/)
  if (!m) throw new Error(`Could not extract sessionId from: ${r.text}`)
  return parseInt(m[1]!, 10)
}

export interface CallResult {
  isError: boolean
  text: string
  imageMimeTypes: string[]
  imageDataLengths: number[]
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  const raw = await client.callTool({name, arguments: args})
  const content = (raw.content ?? []) as Array<{type: string; text?: string; data?: string; mimeType?: string}>
  const texts: string[] = []
  const imageMimeTypes: string[] = []
  const imageDataLengths: number[] = []
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text ?? '')
    if (block.type === 'image') {
      imageMimeTypes.push(block.mimeType ?? '')
      imageDataLengths.push((block.data ?? '').length)
    }
  }
  return {
    isError: raw.isError === true,
    text: texts.join('\n'),
    imageMimeTypes,
    imageDataLengths
  }
}
