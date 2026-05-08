import xtermHeadless, {type Terminal} from '@xterm/headless'

const {Terminal: TerminalClass} = xtermHeadless as unknown as {Terminal: new (options?: object) => Terminal}

export interface CreateTerminalOptions {
  cols: number
  rows: number
  scrollback?: number
}

export function createTerminal(options: CreateTerminalOptions): Terminal {
  return new TerminalClass({
    cols: options.cols,
    rows: options.rows,
    scrollback: options.scrollback ?? 5000,
    allowProposedApi: true
  })
}

export function writeAndFlush(term: Terminal, data: string | Uint8Array): Promise<void> {
  return new Promise(resolve => term.write(data, () => resolve()))
}

export interface BufferState {
  bufferLength: number
  cols: number
  rows: number
  cursorRow: number
  cursorCol: number
  viewportStart: number
  viewportEnd: number
  isAlt: boolean
}

export function bufferState(term: Terminal): BufferState {
  const buf = term.buffer.active
  const baseY = buf.baseY
  return {
    bufferLength: buf.length,
    cols: term.cols,
    rows: term.rows,
    cursorRow: baseY + buf.cursorY,
    cursorCol: buf.cursorX,
    viewportStart: baseY,
    viewportEnd: baseY + term.rows - 1,
    isAlt: buf.type === 'alternate'
  }
}
