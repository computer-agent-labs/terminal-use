import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js'

export interface ImageAttachment {
  data: string
  mimeType: string
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
      content.push({type: 'text', text: this.#lines.join('\n')})
    }
    for (const image of this.#images) {
      content.push({type: 'image', data: image.data, mimeType: image.mimeType})
    }
    if (content.length === 0) {
      content.push({type: 'text', text: ''})
    }
    const result: CallToolResult = {content}
    if (this.#error) result.isError = true
    if (this.#structured) result.structuredContent = this.#structured
    return result
  }
}
