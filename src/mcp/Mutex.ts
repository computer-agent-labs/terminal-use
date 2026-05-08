export class Mutex {
  #locked = false
  #queue: Array<() => void> = []

  async acquire(): Promise<() => void> {
    if (!this.#locked) {
      this.#locked = true
      return () => this.#release()
    }
    await new Promise<void>(resolve => this.#queue.push(resolve))
    return () => this.#release()
  }

  #release(): void {
    const next = this.#queue.shift()
    if (next) {
      next()
    } else {
      this.#locked = false
    }
  }
}
