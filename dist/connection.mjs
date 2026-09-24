import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logWarn } from './log.mjs';
const touchIntervalMs = 60 * 1000;
export function isValidPort(port) {
    return typeof port == 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}
function defaultHost() {
    return (process.env.TALLY_HOST || '').trim() || 'localhost';
}
function defaultPort() {
    let port = parseInt(process.env.TALLY_PORT || '');
    return isValidPort(port) ? port : 9000;
}
function ttlMs() {
    let hours = parseFloat(process.env.TALLY_CONNECTION_TTL_HOURS || '');
    return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 3600 * 1000;
}
/** the installed default the state belongs to; a second install with other defaults keeps its own file */
function defaultKey() {
    return `${defaultHost().toLowerCase()}:${defaultPort()}`;
}
/** location of the state file, overridable through TALLY_STATE_DIR (used by the tests) */
export function connectionStateFile() {
    let dir = (process.env.TALLY_STATE_DIR || '').trim() || path.join(os.homedir(), '.tally-mcp-server');
    let safeKey = defaultKey().replace(/[^a-z0-9.-]+/gi, '_');
    return path.join(dir, `connection-${safeKey}.json`);
}
// the session connection held by this process, used when the state file cannot be written
let memoryConnection = null;
let memoryPersisted = false;
function readStateFile() {
    let file = connectionStateFile();
    try {
        if (!fs.existsSync(file))
            return null;
        let content = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!content || content.defaultKey !== defaultKey() || !isValidPort(content.port) || typeof content.host != 'string' || !content.host.trim())
            return null;
        let touched = Date.parse(content.touchedAt);
        if (!Number.isFinite(touched) || Date.now() - touched > ttlMs()) {
            removeStateFile(); // unused for longer than the TTL: fall back to the installed default
            return null;
        }
        return content;
    }
    catch (err) {
        logWarn('connection', 'state file unreadable, ignoring it', { file, error: err instanceof Error ? err.message : String(err) });
        return null;
    }
}
function writeStateFile(content) {
    let file = connectionStateFile();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        let tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(content), 'utf8');
        try {
            fs.renameSync(tmp, file); // atomic replace, so a concurrent reader never sees half a file
        }
        catch {
            fs.writeFileSync(file, JSON.stringify(content), 'utf8');
            fs.rmSync(tmp, { force: true });
        }
        return true;
    }
    catch (err) {
        logWarn('connection', 'state file could not be written; the connection holds for this process only', { file, error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}
function removeStateFile() {
    try {
        fs.rmSync(connectionStateFile(), { force: true });
    }
    catch {
        // an undeletable file expires through its touchedAt anyway
    }
}
/**
 * The connection every request uses: the session choice stored in the state file (shared by every
 * process of this installation), else this process's own choice when the file could not be written,
 * else the TALLY_HOST / TALLY_PORT default
 */
export function getTallyConnection() {
    let state = readStateFile();
    if (state) {
        if (Date.now() - Date.parse(state.touchedAt) > touchIntervalMs)
            writeStateFile({ ...state, touchedAt: new Date().toISOString() }); // sliding expiry while in use
        memoryConnection = { host: state.host, port: state.port, source: 'session' };
        memoryPersisted = true;
        return { ...memoryConnection };
    }
    if (memoryConnection && !memoryPersisted)
        return { ...memoryConnection };
    memoryConnection = null; // the file was reset or expired by another process
    return { host: defaultHost(), port: defaultPort(), source: 'default' };
}
/**
 * Points the session at a different Tally instance and persists the choice. Host defaults to the current host
 * @param port XML server port of Tally (1 to 65535)
 * @param host optional host name or IP address
 */
export function setTallyConnection(port, host) {
    if (!isValidPort(port))
        throw new Error(`Invalid Tally port [${port}]. Port must be a whole number between 1 and 65535`);
    let targetHost = (typeof host == 'string' && host.trim()) ? host.trim() : getTallyConnection().host;
    let now = new Date().toISOString();
    memoryConnection = { host: targetHost, port, source: 'session' };
    memoryPersisted = writeStateFile({ host: targetHost, port, defaultKey: defaultKey(), setAt: now, touchedAt: now });
    return { ...memoryConnection };
}
/**
 * Restores the connection to the TALLY_HOST / TALLY_PORT defaults and forgets the persisted choice
 */
export function resetTallyConnection() {
    memoryConnection = null;
    memoryPersisted = false;
    removeStateFile();
    return getTallyConnection();
}
/** true when the session connection is stored in the state file rather than in this process only */
export function isConnectionPersisted() {
    return getTallyConnection().source == 'session' && memoryPersisted;
}
//# sourceMappingURL=connection.mjs.map