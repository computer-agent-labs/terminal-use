import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'

import {createMcpServer, type CreateOptions} from '../../src/index.js'

export interface ServerHarness {
  client: Client
  shutdown: () => Promise<void>
}

export async function startServer(extra: Omit<CreateOptions, 'defaults'> = {}): Promise<ServerHarness> {
  // Pin to /bin/sh for deterministic prompts across machines. The user's
  // actual shell is exercised by the manual smoke script and the live MCP run.
  const server = createMcpServer({
    defaults: {shell: '/bin/sh'},
    sweepIntervalMs: 0,
    ...extra
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client({name: 'test-client', version: '1.0.0'}, {capabilities: {}})
  await client.connect(clientTransport)

  return {
    client,
    shutdown: async () => {
      await client.close()
      await server.close()
    }
  }
}

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
