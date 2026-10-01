import {SerializeAddon} from '@xterm/addon-serialize'
import xtermHeadless, {type Terminal} from '@xterm/headless'

// `@xterm/headless` ships as a UMD bundle, so Node's ESM resolver doesn't
// expose `Terminal` as a named export — we have to pull it off the default.
const {Terminal: TerminalClass} = xtermHeadless as unknown as typeof import('@xterm/headless')

export interface CreateTerminalOptions {
  cols: number
  rows: number
  scrollback?: number
}

// Private modes xterm-headless tracks internally but doesn't surface on its
// public `modes` API. We mirror them from the DECSET/DECRST stream instead
// of reaching into `_core`.
interface TrackedModes {
  cursorHidden: boolean
  sgrMouse: boolean
}

interface TerminalExtras {
  modes: TrackedModes
  serializer: SerializeAddon
}

const DECTCEM = 25
const SGR_MOUSE = 1006

const extras = new WeakMap<Terminal, TerminalExtras>()

export function createTerminal(options: CreateTerminalOptions): Terminal {
  const term = new TerminalClass({
    cols: options.cols,
    rows: options.rows,
    scrollback: options.scrollback ?? 5000,
    allowProposedApi: true
  })
  const modes: TrackedModes = {cursorHidden: false, sgrMouse: false}
  const track = (enabled: boolean) => (params: Array<number | number[]>) => {
    for (const p of params) {
      if (p === DECTCEM) modes.cursorHidden = !enabled
      else if (p === SGR_MOUSE) modes.sgrMouse = enabled
    }
    // Never consume — xterm's own handler still has to apply the mode.
    return false
  }
  term.parser.registerCsiHandler({prefix: '?', final: 'h'}, track(true))
  term.parser.registerCsiHandler({prefix: '?', final: 'l'}, track(false))
  const serializer = new SerializeAddon()
  // The addon is typed against the browser `@xterm/xterm` Terminal but only
  // touches the buffer API, which the headless build shares.
  term.loadAddon(serializer as unknown as Parameters<Terminal['loadAddon']>[0])
  extras.set(term, {modes, serializer})
  return term
}

export function isCursorHidden(term: Terminal): boolean {
  return extras.get(term)?.modes.cursorHidden ?? false
}

export function isSgrMouseEnabled(term: Terminal): boolean {
  return extras.get(term)?.modes.sgrMouse ?? false
}

/** `term.reset()` restores default modes; mirror that in our tracked copy. */
export function resetTrackedModes(term: Terminal): void {
  const e = extras.get(term)
  if (e) e.modes = {cursorHidden: false, sgrMouse: false}
}

/**
 * Escape-sequence replay of the terminal's current state (recent scrollback,
 * screen contents, colors, cursor, alt-buffer). Writing it into another
 * terminal of the same size reproduces what this one shows.
 */
export function serializeTerminal(term: Terminal, scrollback: number): string {
  return extras.get(term)?.serializer.serialize({scrollback}) ?? ''
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
  cursorHidden: boolean
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
    cursorHidden: isCursorHidden(term),
    viewportStart: baseY,
    viewportEnd: baseY + term.rows - 1,
    isAlt: buf.type === 'alternate'
  }
}
