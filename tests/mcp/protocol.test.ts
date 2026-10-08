import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {Client} from '@modelcontextprotocol/client'
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio'
import {afterEach, describe, expect, it} from 'vitest'

import {call, createSession, startServer, type Era, type ServerHarness} from './helpers.js'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../bin/terminal-use.js')
const ERAS: Era[] = ['legacy', 'modern']

let harness: ServerHarness | undefined

afterEach(async () => {
  await harness?.shutdown()
  harness = undefined
})

describe.each(ERAS)('protocol era: %s', era => {
  it('negotiates the expected protocol revision', async () => {
    harness = await startServer({}, era)
    expect(harness.client.getProtocolEra()).toBe(era)
    if (era === 'modern') expect(harness.client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
  })

  it('advertises instructions, titles and behavior hints', async () => {
    harness = await startServer({}, era)
    expect(harness.client.getInstructions()).toMatch(/terminal_create returns a sessionId/)
    const {tools} = await harness.client.listTools()
    const names = tools.map(t => t.name)
    expect(names).toEqual([...names].sort())
    // Directories require every tool to state these three outright, not
    // leave them to the protocol's defaults.
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf('boolean')
      expect(tool.annotations?.destructiveHint, tool.name).toBeTypeOf('boolean')
      expect(tool.annotations?.openWorldHint, tool.name).toBeTypeOf('boolean')
    }
    const byName = Object.fromEntries(tools.map(t => [t.name, t]))
    expect(byName.terminal_read!.annotations).toMatchObject({readOnlyHint: true})
    expect(byName.terminal_type!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    })
    expect(byName.terminal_type!.inputSchema.required).toEqual(expect.arrayContaining(['sessionId', 'text']))
  })

  it('identifies itself with a website and HTTPS icons', async () => {
    harness = await startServer({}, era)
    const info = harness.client.getServerVersion()
    expect(info?.websiteUrl).toBe('https://github.com/computer-agent-labs/terminal-use')
    expect(info?.icons?.length).toBeGreaterThan(0)
    for (const icon of info!.icons!) expect(icon.src).toMatch(/^https:\/\//)
  })

  it('keeps a terminal alive across independent calls, addressed only by sessionId', async () => {
    harness = await startServer({}, era)
    const id = await createSession(harness.client)
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'STATE=kept\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: 'echo state-is-$STATE\n',
      idleMs: 250,
      maxWaitMs: 3000
    })
    expect(r.text).toMatch(/^state-is-kept$/m)
  })

  it('reports progress on a long terminal_wait when the client asks for it', async () => {
    harness = await startServer({}, era)
    const id = await createSession(harness.client)
    const messages: string[] = []
    await harness.client.callTool(
      {name: 'terminal_wait', arguments: {sessionId: id, pattern: 'never-appears', timeoutMs: 2600}},
      {onprogress: p => messages.push(p.message ?? '')}
    )
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages[0]).toMatch(/Waiting for \/never-appears\//)
  })

  it('the real binary serves this era over stdio and cleans up when the client goes away', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--shell', '/bin/sh'],
      stderr: 'ignore'
    })
    const client = new Client(
      {name: 'stdio-test', version: '1.0.0'},
      {capabilities: {}, versionNegotiation: era === 'modern' ? {mode: {pin: '2026-07-28'}} : undefined}
    )
    await client.connect(transport)
    try {
      expect(client.getProtocolEra()).toBe(era)
      const created = await call(client, 'terminal_create', {})
      const socket = created.text.match(/--socket '?([^'\s]+\.sock)/)![1]!
      expect(existsSync(socket)).toBe(true)
      const typed = await call(client, 'terminal_type', {
        sessionId: 1,
        text: 'echo over-st""dio\n',
        idleMs: 250,
        maxWaitMs: 3000
      })
      expect(typed.text).toMatch(/^over-stdio$/m)
      await client.close()
      for (let i = 0; i < 50 && existsSync(socket); i++) await new Promise(r => setTimeout(r, 100))
      expect(existsSync(socket)).toBe(false)
    } finally {
      await client.close().catch(() => undefined)
    }
  })
})
