export function totalPages(bufferLength, rows) {
    if (bufferLength <= 0)
        return 1;
    if (rows <= 0)
        return 1;
    return Math.max(1, Math.ceil(bufferLength / rows));
}
export function windowMath(bufferLength, page, rows) {
    const safeBuf = Math.max(0, bufferLength);
    const safeRows = Math.max(1, rows);
    const total = totalPages(safeBuf, safeRows);
    const safePage = Math.max(0, Math.min(page, total - 1));
    const lastIndex = Math.max(0, safeBuf - 1);
    let end = lastIndex - safePage * safeRows;
    if (end < 0)
        end = 0;
    let start = end - safeRows + 1;
    if (start < 0)
        start = 0;
    if (safeBuf === 0) {
        start = 0;
        end = -1;
    }
    return {
        start,
        end,
        rows: safeRows,
        page: safePage,
        totalPages: total
    };
}
//# sourceMappingURL=pagination.js.map