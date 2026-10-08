import {existsSync} from 'node:fs'
import {createConnection} from 'node:net'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {Client} from '@modelcontextprotocol/client'
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {findSockets} from '../../src/attach/client.js'
import {encodeData, FRAME_DATA, FrameDecoder} from '../../src/attach/framing.js'
import {call, startServer, type ServerHarness} from '../mcp/helpers.js'

// End-to-end checks against real Windows shells through ConPTY. The rest of
// the suite drives /bin/sh and cannot run here; this file is the Windows
// counterpart and only runs there (CI: windows-latest).
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../bin/terminal-use.js')

// PowerShell takes a second or two to start and redraws its line as you
// type, so give everything more room than the POSIX tests need.
const settle = {idleMs: 600, maxWaitMs: 8000}

let harness: ServerHarness

async function create(args: Record<string, unknown> = {}): Promise<{id: number; text: string}> {
  const r = await call(harness.client, 'terminal_create', args)
  if (r.isError) throw new Error(r.text)
  return {id: Number(r.text.match(/Created session (\d+)/)![1]), text: r.text}
}

describe.runIf(process.platform === 'win32')('on Windows', () => {
  beforeEach(async () => {
    harness = await startServer()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('runs commands in the default shell, PowerShell', async () => {
    const {id, text} = await create()
    expect(text).toMatch(/shell=powershell\.exe/i)
    // Concatenated, so the typed command itself cannot satisfy the match.
    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: "Write-Output ('hel' + 'lo-win')\n",
      ...settle
    })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/^hello-win$/m)
    expect(r.text).toMatch(/^PS .*>/m)
  })

  it('edits the command line with arrow keys and Backspace', async () => {
    const {id} = await create()
    await call(harness.client, 'terminal_type', {sessionId: id, text: 'Write-Output abXcd', ...settle})
    const r = await call(harness.client, 'terminal_batch', {
      sessionId: id,
      stepIdleMs: 300,
      actions: [
        {type: 'press', key: 'ArrowLeft', count: 2},
        {type: 'press', key: 'Backspace'},
        {type: 'press', key: 'Enter'},
        {type: 'wait', pattern: '^abcd$', timeoutMs: 8000}
      ],
      ...settle
    })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/^abcd$/m)
  })

  it('reports the exit code of a command session', async () => {
    const {id} = await create({command: "Write-Output 'last words'; exit 3"})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    expect(r.text).toMatch(/The command exited \(exit code 3\)/)
    expect(r.text).toMatch(/^last words$/m)
    const read = await call(harness.client, 'terminal_read', {sessionId: id})
    expect(read.isError).toBe(false)
    expect(read.text).toMatch(/^last words$/m)
  })

  it("passes a native program's exit code through PowerShell", async () => {
    const {id} = await create({command: 'cmd /c exit 7'})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    expect(r.text).toMatch(/The command exited \(exit code 7\)/)
  })

  it('runs command sessions in cmd.exe too', async () => {
    const {id} = await create({shell: 'cmd.exe', command: 'echo from-cmd& exit /b 4'})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    expect(r.text).toMatch(/The command exited \(exit code 4\)/)
    expect(r.text).toMatch(/^from-cmd$/m)
  })

  it('sets environment variables and the working directory', async () => {
    const cwd = process.env.TEMP ?? 'C:\\Windows\\Temp'
    const {id} = await create({command: 'Write-Output "v=$env:TU_TEST_VAR"; (Get-Location).Path', env: {TU_TEST_VAR: 'set'}, cwd})
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    expect(r.text).toMatch(/^v=set$/m)
    expect(r.text.toLowerCase()).toContain(cwd.toLowerCase().replace(/\\$/, ''))
  })

  it('waits for output by pattern, and by quiet, while a command runs', async () => {
    const {id} = await create()
    await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: "Start-Sleep -Seconds 2; Write-Output ('sle' + 'pt')\n",
      idleMs: 100,
      maxWaitMs: 500
    })
    const byPattern = await call(harness.client, 'terminal_wait', {sessionId: id, pattern: '^slept$', timeoutMs: 20000})
    expect(byPattern.text).toMatch(/matched after/)
    const quiet = await call(harness.client, 'terminal_wait', {sessionId: id, until: 'quiet', timeoutMs: 20000})
    expect(quiet.text).toMatch(/Output has been quiet/)
  })

  it('says so when it cannot tell whether a command has finished', async () => {
    const {id} = await create()
    // No `ps` here: the default wait falls back to a stretch of silence.
    const r = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/Could not check which process owns the terminal/)
  })

  it('resizes the terminal, and the shell sees it', async () => {
    const {id} = await create()
    const resized = await call(harness.client, 'terminal_resize', {sessionId: id, cols: 100, rows: 30})
    expect(resized.text).toMatch(/to 100x30/)
    const r = await call(harness.client, 'terminal_type', {
      sessionId: id,
      text: "Write-Output ('wid' + 'th=' + $Host.UI.RawUI.WindowSize.Width)\n",
      ...settle
    })
    expect(r.text).toMatch(/^width=100$/m)
  })

  it('renders a screenshot', async () => {
    const {id} = await create()
    await call(harness.client, 'terminal_type', {sessionId: id, text: "Write-Host 'in color' -ForegroundColor Green\n", ...settle})
    const r = await call(harness.client, 'terminal_screenshot', {sessionId: id})
    expect(r.isError).toBe(false)
    expect(r.imageMimeTypes).toEqual(['image/png'])
    expect(r.imageDataLengths[0]).toBeGreaterThan(1000)
  })

  it('lets a human attach through a named pipe', async () => {
    const {id, text} = await create()
    const pipe = text.match(/--socket "?(\\\\\.\\pipe\\[\w-]+)"?/)![1]!
    expect(findSockets(id)).toContain(pipe)

    const decoder = new FrameDecoder()
    let received = ''
    const socket = createConnection(pipe)
    socket.on('data', chunk => {
      for (const f of decoder.push(chunk)) if (f.type === FRAME_DATA) received += f.payload.toString('utf8')
    })
    await new Promise<void>((ok, fail) => {
      socket.once('connect', ok)
      socket.once('error', fail)
    })
    try {
      // The replay brings the attaching terminal up to date: the prompt is there.
      await new Promise(r => setTimeout(r, 1000))
      expect(received).toMatch(/PS /)
      // And typing from the attached side reaches the same shell.
      socket.write(encodeData("Write-Output ('pi' + 'ped')\r"))
      const r = await call(harness.client, 'terminal_wait', {sessionId: id, pattern: '^piped$', timeoutMs: 15000})
      expect(r.text).toMatch(/matched after/)
    } finally {
      socket.destroy()
    }
  })

  it('refuses input after a command session ends, and runs it again on a hard reset', async () => {
    const {id} = await create({command: "Write-Output ('ru' + 'n'); exit 2"})
    await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    const typed = await call(harness.client, 'terminal_type', {sessionId: id, text: 'x\n', ...settle})
    expect(typed.isError).toBe(true)
    expect(typed.text).toMatch(/which exited \(exit code 2\)/)
    await call(harness.client, 'terminal_reset', {sessionId: id, hardReset: true})
    const again = await call(harness.client, 'terminal_wait', {sessionId: id, timeoutMs: 20000})
    expect(again.text).toMatch(/The command exited \(exit code 2\)/)
  })

  it('serves a client over stdio from the real binary, and exits when the client leaves', async () => {
    expect(existsSync(BIN)).toBe(true)
    const transport = new StdioClientTransport({command: process.execPath, args: [BIN], stderr: 'ignore'})
    const client = new Client({name: 'windows-stdio-test', version: '1.0.0'}, {capabilities: {}})
    await client.connect(transport)
    const pid = transport.pid
    try {
      const created = await call(client, 'terminal_create', {})
      expect(created.isError).toBe(false)
      const typed = await call(client, 'terminal_type', {
        sessionId: 1,
        text: "Write-Output ('over-' + 'stdio')\n",
        ...settle
      })
      expect(typed.text).toMatch(/^over-stdio$/m)
    } finally {
      await client.close()
    }
    const gone = async () => {
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(pid!, 0)
        } catch {
          return true
        }
        await new Promise(r => setTimeout(r, 100))
      }
      return false
    }
    expect(await gone()).toBe(true)
  })
})
