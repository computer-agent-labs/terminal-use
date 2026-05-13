/**
 * Wire framing for the attach-CLI ↔ AttachServer Unix socket.
 *
 *   +--------+----------------+---------------------+
 *   | type 1B|   length BE 4B |     payload         |
 *   +--------+----------------+---------------------+
 *
 *   DATA   (0x01)  raw bytes, both directions
 *   RESIZE (0x02)  payload "cols,rows" ASCII, client → server only
 *   DETACH (0xFF)  payload empty, either direction
 *
 * The 4-byte length field is unsigned big-endian. Max payload 2^32-1 bytes
 * (we'd never approach that for a single TCP read — keeps framing simple).
 */
export const FRAME_DATA = 0x01;
export const FRAME_RESIZE = 0x02;
export const FRAME_DETACH = 0xff;
const HEADER_BYTES = 5;
export function encodeFrame(type, payload = Buffer.alloc(0)) {
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
    const out = Buffer.alloc(HEADER_BYTES + body.length);
    out.writeUInt8(type, 0);
    out.writeUInt32BE(body.length, 1);
    body.copy(out, HEADER_BYTES);
    return out;
}
export function encodeData(payload) {
    return encodeFrame(FRAME_DATA, payload);
}
export function encodeResize(cols, rows) {
    return encodeFrame(FRAME_RESIZE, `${cols},${rows}`);
}
export function encodeDetach() {
    return encodeFrame(FRAME_DETACH);
}
/**
 * Stateful decoder that handles partial frames — a single `socket.on('data')`
 * read can deliver any prefix/suffix of the wire stream, so the decoder
 * buffers and emits whole frames as they become available.
 */
export class FrameDecoder {
    #buffer = Buffer.alloc(0);
    push(chunk) {
        this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
        const out = [];
        while (this.#buffer.length >= HEADER_BYTES) {
            const type = this.#buffer.readUInt8(0);
            const length = this.#buffer.readUInt32BE(1);
            const total = HEADER_BYTES + length;
            if (this.#buffer.length < total)
                break;
            const payload = this.#buffer.subarray(HEADER_BYTES, total);
            out.push({ type, payload: Buffer.from(payload) });
            this.#buffer = this.#buffer.subarray(total);
        }
        return out;
    }
    reset() {
        this.#buffer = Buffer.alloc(0);
    }
    get bufferedBytes() {
        return this.#buffer.length;
    }
}
export function parseResize(payload) {
    const parts = payload.toString('utf8').split(',');
    if (parts.length !== 2)
        return undefined;
    const cols = Number.parseInt(parts[0], 10);
    const rows = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1)
        return undefined;
    return { cols, rows };
}
//# sourceMappingURL=framing.js.map