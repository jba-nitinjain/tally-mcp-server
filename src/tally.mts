import http from 'node:http';
import net from 'node:net';
import nunjucks from 'nunjucks';
import { XMLParser } from 'fast-xml-parser';
import * as m from './models.mjs';
import { utility } from './utility.mjs';
import { lstCollectionFields, lstPushXml, lstReportXml, xmlInvokeAction, xmlQueryCollection, xmlDeleteMasters, xmlDeleteVouchers } from './definition.mjs';
import { logDebug, logInfo, logWarn } from './log.mjs';
import { getTallyConnection, isValidPort } from './connection.mjs';
import { TallyTransportError, type TallyTransportPhase } from './tallyerror.mjs';
import { assertCompleteEnvelope } from './envelope.mjs';

export { getTallyConnection, setTallyConnection, resetTallyConnection, type TallyConnection } from './connection.mjs';
export { TallyTransportError, type TallyTransportPhase } from './tallyerror.mjs';

// ---------------------------------------------------------------------------
// Transport settings
//
// The Claude relay which forwards tool calls to this machine gives up after 60s and reports
// "Device did not respond". Earlier a Tally call carried no timeout at all, so a request which
// Tally never answered held the relay open until that 60s expired. Every Tally call now has an
// overall budget kept well under 60s, so this server always answers first with a clear message
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
    let value = parseInt(process.env[name] || '');
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** overall budget for one Tally call, including internal retries */
export const tallyTimeoutMs = envInt('TALLY_TIMEOUT_MS', 45000);
/** time allowed to open the TCP connection (localhost normally connects within a few ms) */
const tallyConnectTimeoutMs = envInt('TALLY_CONNECT_TIMEOUT_MS', 5000);
/** calls slower than this are logged at info level even without TALLY_DEBUG */
const tallySlowCallMs = envInt('TALLY_SLOW_MS', 5000);
/** additional attempts after a connection-level failure of an idempotent read */
const tallyRetryMax = 2;
const tallyRetryBackoffMs = [500, 1500];

// Reads share a keep-alive pool so a call after an idle gap does not pay a fresh TCP handshake.
// maxSockets applies per host:port, so it also bounds how many requests are in flight against one
// Tally instance, which processes XML requests one at a time anyway; the rest wait in this process
const tallyReadAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 15000,
    maxSockets: envInt('TALLY_MAX_SOCKETS', 1),
    maxFreeSockets: 1
});

// Writes always open a fresh connection. A keep-alive socket which Tally closed while idle fails
// with ECONNRESET on reuse; for a read that is retried, but a voucher post must never be re-sent
const tallyWriteAgent = new http.Agent({ keepAlive: false, maxSockets: 1 });

export interface TallySendOptions {
    /** true for reads, which may be safely re-sent after a connection-level failure */
    idempotent?: boolean;
    /** short label for the log line, e.g. report:ledger-account */
    label?: string;
    /** absolute time (ms since epoch) by which the call must finish, when a caller runs several calls under one budget */
    deadline?: number;
}

interface TallyAttemptTiming {
    queueMs: number;
    connectMs: number;
    ttfbMs: number;
    totalMs: number;
    bytes: number;
    reused: boolean;
    connected: boolean;
    headersReceived: boolean;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Target host and port for a single request, used to probe a Tally instance
 * without changing the connection used by the session
 */
export type TallyTarget = { host: string, port: number };

export interface TallyInstanceInfo {
    host: string;
    port: number;
    companies: string[];
    activeCompany: string | null;
    booksFrom: string | null;
}

const nEnv = new nunjucks.Environment();
nEnv.addFilter('formatDate', (dt: Date, format: string) => {
    return utility.Date.format(dt, format);
});

// Templates are compiled once and reused. renderString re-parsed and re-compiled the template
// on every call, which put the compile cost of the larger report templates on every request
const templateCache = new Map<string, nunjucks.Template>();

function getTemplate(xml: string): nunjucks.Template {
    let template = templateCache.get(xml);
    if (!template) {
        template = nunjucks.compile(xml, nEnv);
        templateCache.set(xml, template);
    }
    return template;
}

/**
 * Compiles every known template ahead of the first request
 */
function precompileTemplates(): number {
    let lstXml: string[] = [xmlQueryCollection, xmlInvokeAction, xmlDeleteMasters, xmlDeleteVouchers, ...lstReportXml.values(), ...lstPushXml.values()];
    for (const xml of lstXml)
        getTemplate(xml);
    return lstXml.length;
}

export function renameObjectArrayProperties(source: any[], keyMap: Map<string, string>): any[] {
    if (!Array.isArray(source) || source.length == 0)
        return [];

    if (!(keyMap instanceof Map) || keyMap.size == 0)
        return source.map(item => item);

    return source.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return item;

        let renamed: any = {};
        for (const [key, value] of Object.entries(item)) {
            let targetKey = keyMap.get(key) || key;
            Object.defineProperty(renamed, targetKey, { enumerable: true, value });
        }
        return renamed;
    });
}

/**
 * Coerces a boolean-like value answered by Tally into true / false, or null when it is empty or unrecognised.
 * Tally spells a logical field as "Yes" / "No" when the raw attribute is exported, and as "1" / "0" when the TDL
 * wraps it in "if $X then 1 else 0" (which is what query-collection.njk does). The old check compared against
 * "Yes" only, so every collection boolean (bs_pl, dr_cr, affects_gross_profit, ...) came back false (feedback #33).
 * An empty or unknown value is returned as null rather than silently treated as false, so the caller can see the gap
 */
export function parseTallyBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value === 1 ? true : value === 0 ? false : null;
    if (value === undefined || value === null)
        return null;
    const text = String(value).trim().toLowerCase();
    if (text === 'yes' || text === 'true' || text === '1')
        return true;
    if (text === 'no' || text === 'false' || text === '0')
        return false;
    return null;
}

export async function queryCollection(targetCollection: string, lstFields: string[], lstFilters: Map<string, string>, targetCompany?: string, fromDate?: Date, toDate?: Date, conn?: TallyTarget, timeoutMs?: number): Promise<any[]> {
    let result = await runCollectionQuery(targetCollection, lstFields, lstFilters, targetCompany, fromDate, toDate, conn, timeoutMs);
    return result.rows;
};

/**
 * Runs a collection query and returns the parsed rows along with the raw response,
 * so callers like the port probe can check whether the reply actually came from Tally
 */
async function runCollectionQuery(targetCollection: string, lstFields: string[], lstFilters: Map<string, string>, targetCompany?: string, fromDate?: Date, toDate?: Date, conn?: TallyTarget, timeoutMs?: number): Promise<{ rows: any[], response: string }> {
    let retval: any[] = [];
    try {
        let objTemplateArgs = new Map<string, any>();

        //assign static variables
        if (targetCompany)
            objTemplateArgs.set('targetCompany', utility.String.normaliseName(targetCompany)); //accept the company name raw or escaped; the template escapes it again for XML
        if (fromDate)
            objTemplateArgs.set('fromDate', fromDate);
        if (toDate)
            objTemplateArgs.set('toDate', toDate);

        let objCollection: m.TallyCollectionDefinition = lstCollectionFields.filter(c => c.collection == targetCollection)[0]; //load collection definition
        objTemplateArgs.set('collection', objCollection.tallyType || targetCollection);

        let lstQueryFields = objCollection.fields.filter((f, i, all) => lstFields.includes(f.name) && all.findIndex(o => o.name == f.name) == i); //filter fields based on user query, each field once: a field defined twice in the TDL makes TallyPrime 2.1 pop a modal "Could not find description" which freezes it
        objTemplateArgs.set('fields', lstQueryFields); //filter fields queried by user

        if (objCollection.tallyFilter || (lstFilters && lstFilters.size > 0)) {
            let objFilters: m.TallyFilterDefinition[] = [];
            if (objCollection.tallyFilter)
                objFilters.push({ name: 'BuiltIn', expression: objCollection.tallyFilter });
            for (const [k, v] of (lstFilters || new Map<string, string>()).entries()) {
                objFilters.push({
                    name: k,
                    expression: v
                });
            }
            objTemplateArgs.set('filters', objFilters); //add filters to template arguments
        }

        let respContent = await sendTallyXml(xmlQueryCollection, objTemplateArgs, conn, timeoutMs, { idempotent: true, label: `collection:${targetCollection}` }); //send XML to Tally and get response
        assertCompleteEnvelope(respContent, false); //a DATA envelope cut short is a transport failure, never a shorter list

        let xmlParser = new XMLParser({
            parseTagValue: false,
            htmlEntities: true, //decode numeric character references (&#13; &#10; &#x41;) at parse time, not only the five named ones
            isArray(tagName) {
                return (tagName == 'ROW' || tagName.endsWith('.LIST'))
            },
        });
        let resultObj = xmlParser.parse(respContent);
        if (resultObj && resultObj['DATA'] && Array.isArray(resultObj['DATA']['ROW'])) {
            for (const rowObj of resultObj['DATA']['ROW']) {
                let o: any = new Object();
                for (const field of lstQueryFields) {
                    let _value = rowObj[field.name.toUpperCase()].toString();
                    let value: number | string | boolean | Date | null | undefined = undefined;
                    if (field.datatype == 'boolean')
                        value = parseTallyBoolean(_value); //accepts Yes/No, true/false, 1/0; empty stays null
                    else if (field.datatype == 'number' || field.datatype == 'amount' || field.datatype == 'quantity' || field.datatype == 'rate')
                        value = parseFloat(_value);
                    else if (field.datatype == 'date')
                        value = utility.Date.parse(_value, 'yyyy-MM-dd');
                    else
                        value = utility.String.normaliseName(_value); //Tally escapes text twice in places; decode that second layer, then strip CR/LF/TAB so names round-trip between tools

                    Object.defineProperty(o, field.name, { enumerable: true, value });
                }
                retval.push(o);
            }
        }
        return { rows: retval, response: respContent };
    } catch (err) {
        throw err;
    }

}

/**
 * Invokes a Tally action (a report used only for its side effect, like switching company or period).
 * The response was earlier discarded, which turned every failure into a silent success for the caller,
 * so an exception reported by Tally is now raised instead
 */
export async function invokeTallyAction(targetAction: string, lstParameters: Map<string, any>): Promise<void> {
    try {
        let objTemplateArgs = new Map<string, any>();

        objTemplateArgs.set('targetReport', targetAction);

        let variables: { name: string, value: any }[] = [];
        lstParameters.forEach((v, k) => {
            variables.push({ name: k, value: v });
        });
        objTemplateArgs.set('variables', variables);

        let respContent = await sendTallyXml(xmlInvokeAction, objTemplateArgs); //send XML to Tally

        if (respContent && respContent.includes('<EXCEPTION>')) {
            let regErr = respContent.match(/<EXCEPTION>([\s\S]+?)<\/EXCEPTION>/);
            throw new Error(utility.String.unescapeHTML(regErr ? regErr[1] : 'Unknown error received from Tally'));
        }
    } catch (err) {
        throw err;
    }

}

/**
 * Parses the XML response returned by Tally for any Import Data request and normalises
 * it into a status object. Tally reports failures inside the RESPONSE envelope itself
 * (LINEERROR / EXCEPTIONS), so those are surfaced as an error instead of a silent zero count.
 */
function parseImportResponse(respContent: string): m.CreateUpdateDeleteStatus {
    if (!respContent)
        throw new Error('Empty response received from Tally');

    if (respContent.startsWith('<EXCEPTION>')) {
        let errorMessage = respContent.replace(/<\/?EXCEPTION>/g, '').trim();
        throw new Error(errorMessage || 'Unknown error received from Tally');
    }

    const xmlParser = new XMLParser({ parseTagValue: false, htmlEntities: true });
    let resultObj = xmlParser.parse(respContent);
    let objResponse = resultObj['RESPONSE'];

    if (!objResponse)
        throw new Error(utility.String.unescapeHTML(respContent).substring(0, 500));

    let lineError = objResponse['LINEERROR'];
    if (lineError)
        throw new Error(utility.String.unescapeHTML(Array.isArray(lineError) ? lineError.join(' | ') : lineError.toString()));

    const parseCount = (value: any): number => {
        let parsedValue = parseInt(value);
        return isNaN(parsedValue) ? 0 : parsedValue;
    };

    let retval: m.CreateUpdateDeleteStatus = {
        created: parseCount(objResponse['CREATED']),
        altered: parseCount(objResponse['ALTERED']),
        deleted: parseCount(objResponse['DELETED']),
        combined: parseCount(objResponse['COMBINED']),
        ignored: parseCount(objResponse['IGNORED']),
        cancelled: parseCount(objResponse['CANCELLED']),
        errors: parseCount(objResponse['ERRORS']),
        exceptions: parseCount(objResponse['EXCEPTIONS'])
    };

    if (retval.errors || retval.exceptions)
        throw new Error(`Tally rejected the request with ${retval.errors} error(s) and ${retval.exceptions} exception(s). Kindly validate master names, dates and amounts before retrying`);

    return retval;
}

/**
 * Renders one of the push XML templates and posts it to Tally as an Import Data request
 * @param targetTemplate key of the template registered in lstPushXml
 * @param objInput template arguments
 */
export async function importData(targetTemplate: string, objInput: Map<string, any>): Promise<m.CreateUpdateDeleteStatus> {
    try {
        let xmlTemplate = lstPushXml.get(targetTemplate);
        if (!xmlTemplate)
            throw new Error(`No import template found for ${targetTemplate}`);

        let respContent = await sendTallyXml(xmlTemplate, objInput); //send XML to Tally and get response
        return parseImportResponse(respContent);
    } catch (err) {
        throw err;
    }
}

export async function importMasters(targetMaster: string, objMasterInput: Map<string, any>): Promise<m.CreateUpdateDeleteStatus> {
    return importData(targetMaster, objMasterInput);
}

export async function importVouchers(lstVoucher: any[], targetCompany?: string): Promise<m.CreateUpdateDeleteStatus> {
    let objTemplateArgs = new Map<string, any>();
    objTemplateArgs.set('vouchers', lstVoucher);
    if (targetCompany) {
        objTemplateArgs.set('targetCompany', targetCompany);
    }
    return importData('voucher', objTemplateArgs);
}

export async function deleteMasters(targetCollection: string, lstMaster: string[], targetCompany?: string): Promise<m.CreateUpdateDeleteStatus> {
    try {
        let objTemplateArgs = new Map<string, any>();
        const objCollection = lstCollectionFields.find(c => c.collection == targetCollection);
        objTemplateArgs.set('targetCollection', objCollection?.tallyType || targetCollection); //an employee is deleted as the cost centre Tally stores it as
        objTemplateArgs.set('masters', lstMaster);
        if (targetCompany) {
            objTemplateArgs.set('targetCompany', targetCompany);
        }
        let respContent = await sendTallyXml(xmlDeleteMasters, objTemplateArgs);
        return parseImportResponse(respContent);
    } catch (err) {
        throw err;
    }
}

export async function deleteVouchers(lstVoucher: any[], targetCompany?: string): Promise<m.CreateUpdateDeleteStatus> {
    try {
        let objTemplateArgs = new Map<string, any>();
        objTemplateArgs.set('vouchers', lstVoucher);
        if (targetCompany) {
            objTemplateArgs.set('targetCompany', targetCompany);
        }
        let respContent = await sendTallyXml(xmlDeleteVouchers, objTemplateArgs);
        return parseImportResponse(respContent);
    } catch (err) {
        throw err;
    }
}

/**
 * Renders a template and posts it to Tally, with timing of every phase written to the log.
 * @param conn optional host:port override, defaults to the session connection
 * @param timeoutMs optional overall budget for this call; when given, the call is a probe and is never retried
 * @param options idempotent reads are retried after a connection-level failure, writes are not
 */
export async function sendTallyXml(xml: string, lstVariables: Map<string, any>, conn?: TallyTarget, timeoutMs?: number, options?: TallySendOptions): Promise<string> {
    try {

        // remove targetCompany from lstVariables if found with default value
        if (lstVariables.has('targetCompany') && lstVariables.get('targetCompany') == '##SVCurrentCompany') {
            lstVariables.delete('targetCompany');
        }

        let o = new Object();

        // define properties for every keys in Map in object
        lstVariables.forEach((v, k) => {
            Object.defineProperty(o, k, { enumerable: true, value: v });
        });

        let tRender = Date.now();
        let xmlRequest = getTemplate(xml).render(o);
        let renderMs = Date.now() - tRender;

        let xmlResponse = await postTallyXML(xmlRequest, conn, timeoutMs, options, renderMs);
        return xmlResponse;
    } catch (err) {
        throw err;
    }
}

/**
 * Posts XML to Tally with a bounded budget and a bounded internal retry.
 * The session connection is read on every call so a runtime change takes effect immediately;
 * a caller may target a specific host:port instead (used by port probes).
 *
 * Retry rules: only a connection-level failure is retried (refused, reset, hang up, connect
 * timeout), never an answer from Tally, and never after any response bytes have arrived. A read
 * is retried on any of these; a write is retried only when the connection was never established,
 * so a voucher or master can never be posted twice. An attempt which used the whole budget is
 * not retried because there is no budget left, and the error then says so and marks itself transient
 */
async function postTallyXML(xml: string, conn?: TallyTarget, timeoutMs?: number, options?: TallySendOptions, renderMs?: number): Promise<string> {
    const target: TallyTarget = conn || getTallyConnection();
    const idempotent = options?.idempotent === true;
    const label = options?.label || (idempotent ? 'read' : 'write');
    const isProbe = typeof timeoutMs == 'number' && timeoutMs > 0;
    const budgetMs = isProbe ? timeoutMs : tallyTimeoutMs;
    const t0 = Date.now();
    // a caller running several requests under one budget (ledger-account chunks) passes its own deadline
    const deadline = Math.min(t0 + budgetMs, options?.deadline ?? Number.POSITIVE_INFINITY);
    const maxAttempts = isProbe ? 1 : 1 + tallyRetryMax;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let tAttempt = Date.now();
        try {
            let result = await postTallyXMLOnce(xml, target, idempotent, deadline, attempt);
            let fields = { label, host: target.host, port: target.port, attempt, render_ms: renderMs, queue_ms: result.timing.queueMs, connect_ms: result.timing.connectMs, ttfb_ms: result.timing.ttfbMs, total_ms: result.timing.totalMs, bytes: result.timing.bytes, reused: result.timing.reused };
            if (result.timing.totalMs >= tallySlowCallMs || attempt > 1)
                logInfo('http', 'slow or retried Tally call', fields);
            else
                logDebug('http', 'Tally call', fields);
            return result.body;
        } catch (err) {
            lastError = err;
            let outcome = classifyTransportError(err, target, idempotent, attempt);
            let elapsedMs = Date.now() - tAttempt;
            let remainingMs = deadline - Date.now();
            let backoffMs = tallyRetryBackoffMs[Math.min(attempt - 1, tallyRetryBackoffMs.length - 1)];
            let canRetry = outcome.retryable && attempt < maxAttempts && remainingMs > backoffMs + tallyConnectTimeoutMs;

            logWarn('http', canRetry ? 'Tally call failed, retrying' : 'Tally call failed', {
                label, host: target.host, port: target.port, attempt, phase: outcome.phase, code: outcome.code,
                connected: outcome.timing?.connected, headers: outcome.timing?.headersReceived, reused: outcome.timing?.reused,
                elapsed_ms: elapsedMs, remaining_ms: Math.max(remainingMs, 0), retryable: outcome.retryable, error: outcome.error.message.substring(0, 160)
            });

            if (!canRetry) {
                if (outcome.error instanceof TallyTransportError) {
                    outcome.error.elapsedMs = Date.now() - t0; // reported to the caller as elapsedMs of TALLY_TIMEOUT
                    outcome.error.attempts = attempt;
                }
                throw outcome.error;
            }
            await sleep(backoffMs);
        }
    }
    throw lastError; // unreachable, the loop always throws or returns
}

/**
 * Error raised by a single attempt, carrying the phase timing collected so far
 */
class TallyAttemptError extends Error {
    constructor(readonly cause_: unknown, readonly timing: TallyAttemptTiming) {
        super(cause_ instanceof Error ? cause_.message : String(cause_));
        this.name = 'TallyAttemptError';
    }
}

/**
 * Turns whatever an attempt threw into the error the caller sees, and decides whether it may be retried
 */
function classifyTransportError(err: unknown, target: TallyTarget, idempotent: boolean, attempt: number): { error: Error, retryable: boolean, phase: TallyTransportPhase, code: string, timing?: TallyAttemptTiming } {
    let timing = err instanceof TallyAttemptError ? err.timing : undefined;
    let cause: any = err instanceof TallyAttemptError ? err.cause_ : err;
    let connected = timing?.connected === true;
    let headersReceived = timing?.headersReceived === true;
    let phase: TallyTransportPhase = headersReceived ? 'response' : (connected ? 'response' : 'connect');

    if (cause instanceof TallyTransportError)
        return { error: cause, retryable: !headersReceived && (idempotent || !connected), phase: cause.phase, code: cause.code, timing };

    let code: string = (cause && typeof cause == 'object' && typeof cause.code == 'string') ? cause.code : (cause instanceof Error ? cause.message : String(cause));

    if (code === 'ECONNREFUSED') {
        let error: NodeJS.ErrnoException = new Error('Unable to connect to Tally. Ensure Tally is running and XML server is enabled on port ' + target.port + ' by going to Help (F1) > Settings > Connectivity in Tally and setting Client / Server configuration, set Tally Prime is action as Server');
        error.code = code;
        return { error, retryable: true, phase: 'connect', code, timing };
    }

    // connection-level failures before any response bytes: the request may be re-sent for a read;
    // for a write only when the connection was never established, so nothing could have reached Tally
    const connectionCodes = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND']);
    let isConnectionLevel = connectionCodes.has(code) || /socket hang up/i.test(code) || /^aborted$/i.test(cause?.message || '');
    if (isConnectionLevel && !headersReceived) {
        let retryable = idempotent || !connected;
        let error = new TallyTransportError(phase, code, attempt, `The connection to Tally on ${target.host}:${target.port} was ${connected ? 'dropped before Tally answered' : 'not established'}.`);
        return { error, retryable, phase, code, timing };
    }
    // the connection dropped part way through the answer (Node reports it as "aborted"): whatever
    // arrived is incomplete, so it is a transport failure and never an empty result. Not retried,
    // since Tally did the work and a re-send would repeat it in full
    if (isConnectionLevel && headersReceived) {
        let error = new TallyTransportError('response', 'aborted', attempt, `The connection to Tally on ${target.host}:${target.port} was dropped while the answer was arriving (${timing?.bytes ?? 0} characters received).`);
        return { error, retryable: false, phase: 'response', code: 'aborted', timing };
    }

    let error = cause instanceof Error ? cause : new Error(String(cause));
    return { error, retryable: false, phase, code, timing };
}

/**
 * One HTTP attempt against Tally with three separate deadlines: the connect deadline starts
 * when a socket is assigned (queue time waiting for a free pooled socket is not charged to it),
 * and the overall deadline caps the attempt at whatever is left of the call budget
 */
function postTallyXMLOnce(xml: string, target: TallyTarget, idempotent: boolean, deadline: number, attempt: number): Promise<{ body: string, timing: TallyAttemptTiming }> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        let tSocket = 0, tConnect = 0, tHeaders = 0;
        let bytes = 0;
        let settled = false;
        let timing: TallyAttemptTiming = { queueMs: 0, connectMs: 0, ttfbMs: 0, totalMs: 0, bytes: 0, reused: false, connected: false, headersReceived: false };
        let connectTimer: NodeJS.Timeout | undefined;
        let budgetTimer: NodeJS.Timeout | undefined;

        const remainingMs = deadline - t0;
        if (remainingMs <= 0) {
            reject(new TallyAttemptError(new TallyTransportError('queue', 'budget-exhausted', attempt, 'No time was left in the call budget to send the request.'), timing));
            return;
        }

        const snapshot = () => {
            const now = Date.now();
            timing.queueMs = tSocket ? tSocket - t0 : now - t0;
            timing.connectMs = tConnect && tSocket ? tConnect - tSocket : 0;
            timing.ttfbMs = tHeaders ? tHeaders - (tConnect || tSocket || t0) : 0;
            timing.totalMs = now - t0;
            timing.bytes = bytes;
        };

        const finish = (err?: unknown, body?: string) => {
            if (settled)
                return;
            settled = true;
            if (connectTimer)
                clearTimeout(connectTimer);
            if (budgetTimer)
                clearTimeout(budgetTimer);
            snapshot();
            if (err !== undefined)
                reject(new TallyAttemptError(err, timing));
            else
                resolve({ body: body || '', timing });
        };

        try {
            let req = http.request({
                hostname: target.host,
                port: target.port,
                path: '/',
                method: 'POST',
                agent: idempotent ? tallyReadAgent : tallyWriteAgent,
                headers: {
                    'Content-Length': Buffer.byteLength(xml, 'utf16le'),
                    'Content-Type': 'text/xml;charset=utf-16'
                }
            },
                (res) => {
                    tHeaders = Date.now();
                    timing.headersReceived = true;
                    let data = '';
                    res
                        .setEncoding('utf16le')
                        .on('data', (chunk) => {
                            let result = chunk.toString() || '';
                            bytes += result.length;
                            data += result;
                        })
                        .on('end', () => finish(undefined, data))
                        .on('error', (httpErr) => finish(httpErr));
                });

            req.on('socket', (socket) => {
                tSocket = Date.now();
                timing.reused = (req as any).reusedSocket === true;
                if (socket.connecting) {
                    socket.once('connect', () => {
                        tConnect = Date.now();
                        timing.connected = true;
                    });
                    connectTimer = setTimeout(() => {
                        if (!timing.connected)
                            req.destroy(new TallyTransportError('connect', 'connect-timeout', attempt, `No TCP connection to Tally on ${target.host}:${target.port} within ${tallyConnectTimeoutMs}ms.`));
                    }, Math.min(tallyConnectTimeoutMs, Math.max(deadline - Date.now(), 1)));
                }
                else {
                    tConnect = tSocket;
                    timing.connected = true;
                }
            });

            budgetTimer = setTimeout(() => {
                let phase: TallyTransportPhase = timing.connected ? 'response' : (tSocket ? 'connect' : 'queue');
                let detail = timing.headersReceived
                    ? `Tally started answering but the response did not complete (${bytes} characters received).`
                    : (timing.connected ? 'The request reached Tally but no response arrived.' : 'The request was still waiting for a connection to Tally.');
                req.destroy(new TallyTransportError(phase, 'timeout', attempt, detail));
            }, remainingMs);

            req.on('error', (reqError) => finish(reqError));
            req.write(xml, 'utf16le');
            req.end();
        }
        catch (err) {
            finish(err);
        }
    });
}

/**
 * One-time initialisation moved off the request path: compiles every template and sends one
 * lightweight Company query to the default Tally so the keep-alive socket is open before the
 * first tool call. Never throws; an unreachable Tally is only logged, since it may be started later
 */
export async function warmTallyConnection(): Promise<void> {
    let t0 = Date.now();
    let templateCount = 0;
    try {
        templateCount = precompileTemplates();
    } catch (err) {
        logWarn('warmup', 'template precompile failed', { error: err instanceof Error ? err.message : String(err) });
    }
    let tTemplates = Date.now() - t0;

    let tQuery = Date.now();
    try {
        let result = await runCollectionQuery('Company', ['Name'], new Map<string, string>(), undefined, undefined, undefined, undefined, 5000);
        logInfo('warmup', 'Tally answered', { host: getTallyConnection().host, port: getTallyConnection().port, companies: result.rows.length, templates: templateCount, templates_ms: tTemplates, query_ms: Date.now() - tQuery, budget_ms: tallyTimeoutMs, connect_timeout_ms: tallyConnectTimeoutMs });
    } catch (err) {
        logWarn('warmup', 'Tally did not answer, first tool call will connect instead', { host: getTallyConnection().host, port: getTallyConnection().port, templates: templateCount, templates_ms: tTemplates, query_ms: Date.now() - tQuery, error: err instanceof Error ? err.message.substring(0, 160) : String(err) });
    }
}

/**
 * Checks whether a raw response body looks like it was produced by Tally's XML server.
 * Other HTTP services on the port (or non-HTTP services) never produce these envelopes
 */
function isTallyResponse(respContent: string): boolean {
    if (typeof respContent != 'string')
        return false;
    let body = respContent.replace(/^﻿/, '').trim();
    if (!body.startsWith('<'))
        return false;
    return /<(DATA|ENVELOPE|RESPONSE|EXCEPTION|LINEERROR)\b/i.test(body);
}

/**
 * Probes a single host:port to check if a Tally XML server is listening there.
 * Returns null when the port is closed, the service does not speak Tally XML, or the request times out.
 * Never throws, so it is safe to run in bulk during a port scan
 * @param timeoutMs socket inactivity timeout (default 3000)
 */
export async function probeTallyInstance(host: string, port: number, timeoutMs: number = 3000): Promise<TallyInstanceInfo | null> {
    try {
        if (typeof host != 'string' || !host.trim() || !isValidPort(port))
            return null;

        let target: TallyTarget = { host: host.trim(), port };
        let result = await runCollectionQuery('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map<string, string>(), undefined, undefined, undefined, target, timeoutMs);

        if (!isTallyResponse(result.response))
            return null; //something answered, but it was not Tally

        let companies: string[] = result.rows
            .map(r => r['Name'])
            .filter(n => typeof n == 'string' && n.trim() != '');

        let objActive = result.rows.find(r => r['IsActiveCompany'] === true && typeof r['Name'] == 'string' && r['Name'].trim() != '');

        let booksFrom: string | null = null;
        if (objActive && objActive['BooksFrom'] instanceof Date && !isNaN(objActive['BooksFrom'].getTime()))
            booksFrom = utility.Date.format(objActive['BooksFrom'], 'yyyy-MM-dd');

        return {
            host: target.host,
            port: target.port,
            companies,
            activeCompany: objActive ? objActive['Name'] : null,
            booksFrom
        };
    } catch (err) {
        return null;
    }
}

/**
 * Cheap TCP connect check used to skip closed ports before the heavier XML probe
 */
function isTcpPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        let socket = net.connect({ host, port });

        const finish = (isOpen: boolean) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            resolve(isOpen);
        };

        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

/**
 * Scans a port range on a host and returns every port where a Tally XML server answered, sorted by port.
 * Step 1 is a fast TCP probe (300ms, 100 at a time) so a range of closed ports finishes in seconds;
 * step 2 sends the Company query only to ports that accepted the connection (10 at a time)
 * @param host defaults to the current connection host
 * @param fromPort defaults to 9000
 * @param toPort defaults to 9999
 */
export async function scanTallyInstances(host?: string, fromPort: number = 9000, toPort: number = 9999): Promise<TallyInstanceInfo[]> {
    let targetHost = (typeof host == 'string' && host.trim()) ? host.trim() : getTallyConnection().host;

    if (!isValidPort(fromPort) || !isValidPort(toPort))
        throw new Error(`Invalid port range [${fromPort}-${toPort}]. Ports must be whole numbers between 1 and 65535`);
    if (fromPort > toPort)
        throw new Error(`Invalid port range [${fromPort}-${toPort}]. Starting port must not be greater than ending port`);
    if (toPort - fromPort + 1 > 2000)
        throw new Error(`Port range [${fromPort}-${toPort}] is too wide. At most 2000 ports can be scanned at a time`);

    const tcpTimeoutMs = 300;
    const tcpConcurrency = 100;
    const probeConcurrency = 10;

    //step 1: find ports that accept a TCP connection
    let lstPorts: number[] = [];
    for (let p = fromPort; p <= toPort; p++)
        lstPorts.push(p);

    let lstOpenPorts: number[] = [];
    for (let i = 0; i < lstPorts.length; i += tcpConcurrency) {
        let batch = lstPorts.slice(i, i + tcpConcurrency);
        let results = await Promise.all(batch.map(p => isTcpPortOpen(targetHost, p, tcpTimeoutMs)));
        results.forEach((isOpen, idx) => {
            if (isOpen)
                lstOpenPorts.push(batch[idx]);
        });
    }

    //step 2: ask each open port whether it is Tally; non-Tally services are dropped silently
    let retval: TallyInstanceInfo[] = [];
    for (let i = 0; i < lstOpenPorts.length; i += probeConcurrency) {
        let batch = lstOpenPorts.slice(i, i + probeConcurrency);
        let results = await Promise.all(batch.map(p => probeTallyInstance(targetHost, p)));
        for (const info of results) {
            if (info)
                retval.push(info);
        }
    }

    return retval.sort((a, b) => a.port - b.port);
}
