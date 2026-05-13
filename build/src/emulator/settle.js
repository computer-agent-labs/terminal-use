export const HARD_CAP_MS = 10000;
export function ptyAsSource(pty) {
    return {
        onData(cb) {
            return pty.onData(cb);
        }
    };
}
export function waitSettled(source, options) {
    const start = Date.now();
    if (options.maxWaitMs > HARD_CAP_MS) {
        return Promise.resolve({ outcome: 'deferred', elapsedMs: 0, bytesObserved: 0 });
    }
    return new Promise(resolve => {
        let bytes = 0;
        let firstArrived = false;
        let idleTimer = null;
        let maxTimer = null;
        const cleanup = () => {
            if (idleTimer)
                clearTimeout(idleTimer);
            if (maxTimer)
                clearTimeout(maxTimer);
            disposable.dispose();
        };
        const finish = (outcome) => {
            cleanup();
            resolve({ outcome, elapsedMs: Date.now() - start, bytesObserved: bytes });
        };
        const noActivityMs = Math.min(options.maxWaitMs, Math.max(options.idleMs * 4, 1000));
        const disposable = source.onData(chunk => {
            bytes += chunk.length;
            if (!firstArrived)
                firstArrived = true;
            if (idleTimer)
                clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish('settled'), options.idleMs);
        });
        idleTimer = setTimeout(() => finish('settled'), noActivityMs);
        maxTimer = setTimeout(() => finish(firstArrived ? 'timeout' : 'settled'), options.maxWaitMs);
    });
}
//# sourceMappingURL=settle.js.map