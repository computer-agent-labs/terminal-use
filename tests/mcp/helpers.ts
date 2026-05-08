import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'

import {createMcpServer} from '../../src/index.js'

export interface ServerHarness {
  client: Client
  shutdown: () => Promise<void>
}

export async function startServer(): Promise<ServerHarness> {
  // Pin to /bin/sh for deterministic prompts and output across machines.
  // Tests that drive the server through MCP rely on shell behavior matching
  // their assertions; the user's preferred zsh/bash with fancy prompts is
  // exercised by the manual smoke script and live MCP run.
  process.env.SHELL = '/bin/sh'
  process.env.PS1 = '$ '
  process.env.PROMPT_COMMAND = ''

  const server = createMcpServer()
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
