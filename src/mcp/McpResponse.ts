import type {CallToolResult} from '@modelcontextprotocol/server'

export interface ImageAttachment {
  data: string
  mimeType: string
}

/**
 * Replace lone UTF-16 surrogates with U+FFFD (the Unicode replacement
 * character). A lone surrogate is a code unit in D800–DFFF without its
 * pair — JS strings can hold them but they are not valid Unicode, and
 * shipping one back to the API breaks JSON serialization on the client
 * side ("invalid high surrogate in string"). Programs in the shell can
 * print byte sequences (binary data, partial UTF-8, raw 16-bit code
 * units) that xterm-headless decodes into lone surrogates; if we don't
 * scrub them here, a single bad terminal_read response can wedge the
 * entire conversation history.
 */
export function sanitizeUnicode(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '�'
  )
}

function sanitizeStructured(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeUnicode(value)
  if (Array.isArray(value)) return value.map(sanitizeStructured)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[sanitizeUnicode(k)] = sanitizeStructured(v)
    }
    return out
  }
  return value
}

export class McpResponse {
  #lines: string[] = []
  #images: ImageAttachment[] = []
  #structured: Record<string, unknown> | undefined
  #error = false

  appendLine(line: string): void {
    this.#lines.push(line)
  }

  appendBlank(): void {
    this.#lines.push('')
  }

  attachImage(image: ImageAttachment): void {
    this.#images.push(image)
  }

  setStructured(value: Record<string, unknown>): void {
    this.#structured = value
  }

  setError(message: string): void {
    this.#error = true
    this.#lines.push(message)
  }

  get hasError(): boolean {
    return this.#error
  }

  build(): CallToolResult {
    const content: CallToolResult['content'] = []
    if (this.#lines.length > 0) {
      content.push({type: 'text', text: sanitizeUnicode(this.#lines.join('\n'))})
    }
    for (const image of this.#images) {
      // Image data is base64; mimeType is ASCII. Nothing to sanitize.
      content.push({type: 'image', data: image.data, mimeType: image.mimeType})
    }
    if (content.length === 0) {
      content.push({type: 'text', text: ''})
    }
    const result: CallToolResult = {content}
    if (this.#error) result.isError = true
    if (this.#structured) result.structuredContent = sanitizeStructured(this.#structured) as Record<string, unknown>
    return result
  }
}
