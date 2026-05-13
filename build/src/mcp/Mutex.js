export class Mutex {
    #locked = false;
    #queue = [];
    async acquire() {
        if (!this.#locked) {
            this.#locked = true;
            return () => this.#release();
        }
        await new Promise(resolve => this.#queue.push(resolve));
        return () => this.#release();
    }
    #release() {
        const next = this.#queue.shift();
        if (next) {
            next();
        }
        else {
            this.#locked = false;
        }
    }
}
//# sourceMappingURL=Mutex.js.map