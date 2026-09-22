/**
 * Minimal structured logger writing to stderr only.
 * stdout is the MCP stdio transport when the server is launched by Claude Desktop, so nothing
 * diagnostic may ever be written there. Debug lines are emitted only when TALLY_DEBUG=1 (or
 * LOG_LEVEL=debug); info and warn lines are always emitted.
 */
const isDebugEnabled = /^(1|true|yes|on)$/i.test(process.env.TALLY_DEBUG || '') || /debug|trace/i.test(process.env.LOG_LEVEL || '');
function formatFields(fields) {
    if (!fields)
        return '';
    let retval = '';
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined)
            continue;
        if (value instanceof Error)
            retval += ` ${key}=${JSON.stringify(value.message)}`;
        else if (typeof value == 'string')
            retval += ` ${key}=${JSON.stringify(value)}`;
        else
            retval += ` ${key}=${String(value)}`;
    }
    return retval;
}
function write(level, area, message, fields) {
    try {
        process.stderr.write(`${new Date().toISOString()} ${level.padEnd(5)} ${area} ${message}${formatFields(fields)}\n`);
    }
    catch {
        // a broken stderr must never take a request down
    }
}
export function isDebugLogging() {
    return isDebugEnabled;
}
export function logDebug(area, message, fields) {
    if (isDebugEnabled)
        write('debug', area, message, fields);
}
export function logInfo(area, message, fields) {
    write('info', area, message, fields);
}
export function logWarn(area, message, fields) {
    write('warn', area, message, fields);
}
//# sourceMappingURL=log.mjs.map