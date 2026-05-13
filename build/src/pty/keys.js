const MODIFIER_NAMES = {
    ctrl: 'ctrl',
    control: 'ctrl',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
    meta: 'meta',
    cmd: 'meta',
    command: 'meta',
    super: 'meta',
    win: 'meta'
};
export function parseKeySpec(spec) {
    if (!spec || typeof spec !== 'string') {
        throw new Error(`Invalid key spec: ${JSON.stringify(spec)}`);
    }
    const parts = spec.split('+').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) {
        throw new Error(`Invalid key spec: ${JSON.stringify(spec)}`);
    }
    const result = { ctrl: false, alt: false, shift: false, meta: false, base: '' };
    for (let i = 0; i < parts.length - 1; i++) {
        const mod = MODIFIER_NAMES[parts[i].toLowerCase()];
        if (!mod) {
            throw new Error(`Unknown modifier: ${parts[i]} in ${JSON.stringify(spec)}`);
        }
        result[mod] = true;
    }
    result.base = parts[parts.length - 1];
    return result;
}
function modifierParam(p) {
    return 1 + (p.shift ? 1 : 0) + (p.alt ? 2 : 0) + (p.ctrl ? 4 : 0) + (p.meta ? 8 : 0);
}
const ARROW_LETTERS = {
    arrowup: 'A',
    up: 'A',
    arrowdown: 'B',
    down: 'B',
    arrowright: 'C',
    right: 'C',
    arrowleft: 'D',
    left: 'D',
    home: 'H',
    end: 'F'
};
const TILDE_KEYS = {
    insert: 2,
    delete: 3,
    pageup: 5,
    pagedown: 6,
    f5: 15,
    f6: 17,
    f7: 18,
    f8: 19,
    f9: 20,
    f10: 21,
    f11: 23,
    f12: 24
};
const F1_F4 = { f1: 'P', f2: 'Q', f3: 'R', f4: 'S' };
function arrowSequence(letter, mod) {
    if (mod === 1)
        return `\x1b[${letter}`;
    return `\x1b[1;${mod}${letter}`;
}
function tildeSequence(num, mod) {
    if (mod === 1)
        return `\x1b[${num}~`;
    return `\x1b[${num};${mod}~`;
}
function f1f4Sequence(letter, mod) {
    if (mod === 1)
        return `\x1bO${letter}`;
    return `\x1b[1;${mod}${letter}`;
}
export function keyToBytes(spec) {
    const p = parseKeySpec(spec);
    const baseLower = p.base.toLowerCase();
    const mod = modifierParam(p);
    if (baseLower === 'tab') {
        if (p.shift && !p.ctrl && !p.alt && !p.meta)
            return '\x1b[Z';
        if (mod === 1)
            return '\t';
        throw new Error(`Unsupported modifier combination on Tab: ${spec}`);
    }
    if (baseLower === 'enter' || baseLower === 'return') {
        if (mod === 1)
            return '\r';
        throw new Error(`Unsupported modifier combination on Enter: ${spec}`);
    }
    if (baseLower === 'escape' || baseLower === 'esc') {
        if (mod === 1)
            return '\x1b';
        throw new Error(`Unsupported modifier combination on Escape: ${spec}`);
    }
    if (baseLower === 'backspace') {
        if (mod === 1)
            return '\x7f';
        if (p.alt && !p.ctrl && !p.shift && !p.meta)
            return '\x1b\x7f';
        throw new Error(`Unsupported modifier combination on Backspace: ${spec}`);
    }
    if (baseLower === 'space') {
        if (p.ctrl && !p.alt && !p.shift && !p.meta)
            return '\x00';
        if (mod === 1)
            return ' ';
        throw new Error(`Unsupported modifier combination on Space: ${spec}`);
    }
    const arrow = ARROW_LETTERS[baseLower];
    if (arrow !== undefined) {
        return arrowSequence(arrow, mod);
    }
    const tilde = TILDE_KEYS[baseLower];
    if (tilde !== undefined) {
        return tildeSequence(tilde, mod);
    }
    const f14 = F1_F4[baseLower];
    if (f14 !== undefined) {
        return f1f4Sequence(f14, mod);
    }
    if (/^[a-z]$/i.test(p.base)) {
        if (p.ctrl && !p.alt && !p.shift && !p.meta) {
            const code = p.base.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0) + 1;
            return String.fromCharCode(code);
        }
        if (p.alt && !p.ctrl && !p.shift && !p.meta) {
            return `\x1b${p.base.toLowerCase()}`;
        }
        if (p.alt && p.shift && !p.ctrl && !p.meta) {
            return `\x1b${p.base.toUpperCase()}`;
        }
        if (mod === 1) {
            throw new Error(`Plain letter keys should be sent via terminal_type, not terminal_press: ${spec}`);
        }
        throw new Error(`Unsupported modifier combination on letter: ${spec}`);
    }
    if (p.ctrl && !p.alt && !p.shift && !p.meta) {
        if (p.base === '@')
            return '\x00';
        if (p.base === '[')
            return '\x1b';
        if (p.base === '\\')
            return '\x1c';
        if (p.base === ']')
            return '\x1d';
        if (p.base === '^')
            return '\x1e';
        if (p.base === '_')
            return '\x1f';
        if (p.base === '?')
            return '\x7f';
    }
    throw new Error(`Unknown key: ${spec}`);
}
export function keyToBuffer(spec, count = 1) {
    const bytes = keyToBytes(spec);
    if (count <= 1)
        return Buffer.from(bytes, 'utf8');
    return Buffer.from(bytes.repeat(count), 'utf8');
}
//# sourceMappingURL=keys.js.map