import http from 'node:http';
import net from 'node:net';
import nunjucks from 'nunjucks';
import { XMLParser } from 'fast-xml-parser';
import { utility } from './utility.mjs';
import { lstCollectionFields, lstPushXml, lstReportConfig, lstReportXml, xmlInvokeAction, xmlQueryCollection, xmlDeleteMasters, xmlDeleteVouchers } from './definition.mjs';
import { logDebug, logInfo, logWarn } from './log.mjs';
const default_tally_port = parseInt(process.env.TALLY_PORT || '9000') || 9000; // default to 9000 XML port of Tally
const default_tally_host = process.env.TALLY_HOST || 'localhost'; // default to localhost
const lstPullReport = lstReportConfig;
// ---------------------------------------------------------------------------
// Transport settings
//
// The Claude relay which forwards tool calls to this machine gives up after 60s and reports
// "Device did not respond". Earlier a Tally call carried no timeout at all, so a request which
// Tally never answered held the relay open until that 60s expired. Every Tally call now has an
// overall budget kept well under 60s, so this server always answers first with a clear message
// ---------------------------------------------------------------------------
function envInt(name, fallback) {
    let value = parseInt(process.env[name] || '');
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
/** overall budget for one Tally call, including internal retries */
const tallyTimeoutMs = envInt('TALLY_TIMEOUT_MS', 45000);
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
/**
 * A failure of the HTTP transport to Tally as opposed to an answer from Tally. Carries the phase
 * which failed, so the log shows whether the time went into connecting or into waiting for the
 * report, and states in plain words that an identical retry is expected to succeed
 */
export class TallyTransportError extends Error {
    phase;
    code;
    attempts;
    retryable = true;
    constructor(phase, code, attempts, detail) {
        super(`Tally did not answer within the ${Math.round(tallyTimeoutMs / 1000)}s allowed (${phase} phase, ${code}, ${attempts} attempt${attempts == 1 ? '' : 's'}). ${detail} This is a transient connection condition and not a problem with the data requested: an identical retry is expected to succeed. If it keeps happening, check whether Tally Prime is showing a dialog box or is busy with another task`);
        this.name = 'TallyTransportError';
        this.phase = phase;
        this.code = code;
        this.attempts = attempts;
    }
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// live connection used by every request. Earlier this was fixed at process start,
// so a Tally running on another port could not be reached without a restart
let tallyConnection = {
    host: default_tally_host,
    port: default_tally_port,
    source: 'default'
};
function isValidPort(port) {
    return typeof port == 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}
export function getTallyConnection() {
    return { ...tallyConnection };
}
/**
 * Points the session at a different Tally instance. Host defaults to the current host
 * @param port XML server port of Tally (1 to 65535)
 * @param host optional host name or IP address
 */
export function setTallyConnection(port, host) {
    if (!isValidPort(port))
        throw new Error(`Invalid Tally port [${port}]. Port must be a whole number between 1 and 65535`);
    let targetHost = (typeof host == 'string' && host.trim()) ? host.trim() : tallyConnection.host;
    tallyConnection = { host: targetHost, port, source: 'session' };
    return getTallyConnection();
}
/**
 * Restores the connection to the TALLY_HOST / TALLY_PORT defaults
 */
export function resetTallyConnection() {
    tallyConnection = { host: default_tally_host, port: default_tally_port, source: 'default' };
    return getTallyConnection();
}
const nEnv = new nunjucks.Environment();
nEnv.addFilter('formatDate', (dt, format) => {
    return utility.Date.format(dt, format);
});
// Templates are compiled once and reused. renderString re-parsed and re-compiled the template
// on every call, which put the compile cost of the larger report templates on every request
const templateCache = new Map();
function getTemplate(xml) {
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
function precompileTemplates() {
    let lstXml = [xmlQueryCollection, xmlInvokeAction, xmlDeleteMasters, xmlDeleteVouchers, ...lstReportXml.values(), ...lstPushXml.values()];
    for (const xml of lstXml)
        getTemplate(xml);
    return lstXml.length;
}
export function renameObjectArrayProperties(source, keyMap) {
    if (!Array.isArray(source) || source.length == 0)
        return [];
    if (!(keyMap instanceof Map) || keyMap.size == 0)
        return source.map(item => item);
    return source.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return item;
        let renamed = {};
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
export function parseTallyBoolean(value) {
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
export async function fetchReport(targetReport, inputParams) {
    let retval = {
        data: undefined
    };
    try {
        let objReport = lstPullReport.find(p => p.name == targetReport);
        if (objReport) {
            let lstInputs = new Map();
            //set target company
            let targetCompany = '##SVCurrentCompany'; //default value
            if (inputParams.has('targetCompany') && typeof inputParams.get('targetCompany') == 'string')
                targetCompany = utility.String.normaliseName(inputParams.get('targetCompany')); //extract from request object, accepting raw or escaped form
            lstInputs.set('targetCompany', targetCompany); //add targetCompany as one of the params
            //populate input parameters value
            for (let i = 0; i < objReport.input.length; i++) {
                let iName = objReport.input[i].name;
                let iType = objReport.input[i].datatype;
                let _value = inputParams.get(iName);
                //check if validation is required
                if (objReport.input[i].validation_regex) {
                    let strValidationRegex = objReport.input[i].validation_regex || '';
                    let regPtrn = new RegExp(strValidationRegex, 'i');
                    if (typeof _value == 'string' && !regPtrn.test(_value)) {
                        retval.error = objReport.input[i].validation_message || `Invalid value for parameter ${iName}`;
                        return retval;
                    }
                }
                //parse the value based on type
                if (typeof _value == 'number' && iType == 'number')
                    lstInputs.set(iName, _value);
                else if (typeof _value == 'boolean' && iType == 'boolean')
                    lstInputs.set(iName, _value);
                else if (typeof _value == 'string' && iType == 'date' && /^\d\d-\d\d-\d\d\d\d$/.test(_value)) //Date in DD-MM-YYYY
                    lstInputs.set(iName, utility.Date.parse(_value, 'dd-MM-yyyy'));
                else if (typeof _value == 'string' && iType == 'date' && /^\d\d\d\d-\d\d-\d\d/.test(_value)) //ISO DateTime YYYY-MM-DDTHH:MM:SS
                    lstInputs.set(iName, utility.Date.parse(_value.substring(0, 10), 'yyyy-MM-dd'));
                else if (typeof _value == 'string' && iType == 'string')
                    lstInputs.set(iName, utility.String.normaliseName(_value)); //names (ledgerName, itemName) are accepted raw or escaped
                else {
                    retval.error = `Parameter ${iName} not found or contains invalid value [${_value}]`;
                    return retval;
                }
            }
            retval = await extractReport(objReport, lstInputs);
        }
        else
            retval.error = 'Invalid report';
    }
    catch (err) {
        // earlier every exception collapsed to 'Server exception', which hid a transport timeout
        // (and its retry advice) from the caller
        retval.error = err instanceof Error ? err.message : (typeof err == 'string' ? err : 'Server exception');
    }
    finally {
        return retval;
    }
}
export async function queryCollection(targetCollection, lstFields, lstFilters, targetCompany, fromDate, toDate, conn, timeoutMs) {
    let result = await runCollectionQuery(targetCollection, lstFields, lstFilters, targetCompany, fromDate, toDate, conn, timeoutMs);
    return result.rows;
}
;
/**
 * Runs a collection query and returns the parsed rows along with the raw response,
 * so callers like the port probe can check whether the reply actually came from Tally
 */
async function runCollectionQuery(targetCollection, lstFields, lstFilters, targetCompany, fromDate, toDate, conn, timeoutMs) {
    let retval = [];
    try {
        let objTemplateArgs = new Map();
        //assign static variables
        if (targetCompany)
            objTemplateArgs.set('targetCompany', utility.String.normaliseName(targetCompany)); //accept the company name raw or escaped; the template escapes it again for XML
        if (fromDate)
            objTemplateArgs.set('fromDate', fromDate);
        if (toDate)
            objTemplateArgs.set('toDate', toDate);
        let objCollection = lstCollectionFields.filter(c => c.collection == targetCollection)[0]; //load collection definition
        objTemplateArgs.set('collection', objCollection.tallyType || targetCollection);
        let lstQueryFields = objCollection.fields.filter(f => lstFields.includes(f.name)); //filter fields based on user query
        objTemplateArgs.set('fields', lstQueryFields); //filter fields queried by user
        if (objCollection.tallyFilter || (lstFilters && lstFilters.size > 0)) {
            let objFilters = [];
            if (objCollection.tallyFilter)
                objFilters.push({ name: 'BuiltIn', expression: objCollection.tallyFilter });
            for (const [k, v] of (lstFilters || new Map()).entries()) {
                objFilters.push({
                    name: k,
                    expression: v
                });
            }
            objTemplateArgs.set('filters', objFilters); //add filters to template arguments
        }
        let respContent = await sendTallyXml(xmlQueryCollection, objTemplateArgs, conn, timeoutMs, { idempotent: true, label: `collection:${targetCollection}` }); //send XML to Tally and get response
        let xmlParser = new XMLParser({
            parseTagValue: false,
            htmlEntities: true, //decode numeric character references (&#13; &#10; &#x41;) at parse time, not only the five named ones
            isArray(tagName) {
                return (tagName == 'ROW' || tagName.endsWith('.LIST'));
            },
        });
        let resultObj = xmlParser.parse(respContent);
        if (resultObj && resultObj['DATA'] && Array.isArray(resultObj['DATA']['ROW'])) {
            for (const rowObj of resultObj['DATA']['ROW']) {
                let o = new Object();
                for (const field of lstQueryFields) {
                    let _value = rowObj[field.name.toUpperCase()].toString();
                    let value = undefined;
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
    }
    catch (err) {
        throw err;
    }
}
/**
 * Invokes a Tally action (a report used only for its side effect, like switching company or period).
 * The response was earlier discarded, which turned every failure into a silent success for the caller,
 * so an exception reported by Tally is now raised instead
 */
export async function invokeTallyAction(targetAction, lstParameters) {
    try {
        let objTemplateArgs = new Map();
        objTemplateArgs.set('targetReport', targetAction);
        let variables = [];
        lstParameters.forEach((v, k) => {
            variables.push({ name: k, value: v });
        });
        objTemplateArgs.set('variables', variables);
        let respContent = await sendTallyXml(xmlInvokeAction, objTemplateArgs); //send XML to Tally
        if (respContent && respContent.includes('<EXCEPTION>')) {
            let regErr = respContent.match(/<EXCEPTION>([\s\S]+?)<\/EXCEPTION>/);
            throw new Error(utility.String.unescapeHTML(regErr ? regErr[1] : 'Unknown error received from Tally'));
        }
    }
    catch (err) {
        throw err;
    }
}
/**
 * Parses the XML response returned by Tally for any Import Data request and normalises
 * it into a status object. Tally reports failures inside the RESPONSE envelope itself
 * (LINEERROR / EXCEPTIONS), so those are surfaced as an error instead of a silent zero count.
 */
function parseImportResponse(respContent) {
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
    const parseCount = (value) => {
        let parsedValue = parseInt(value);
        return isNaN(parsedValue) ? 0 : parsedValue;
    };
    let retval = {
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
export async function importData(targetTemplate, objInput) {
    try {
        let xmlTemplate = lstPushXml.get(targetTemplate);
        if (!xmlTemplate)
            throw new Error(`No import template found for ${targetTemplate}`);
        let respContent = await sendTallyXml(xmlTemplate, objInput); //send XML to Tally and get response
        return parseImportResponse(respContent);
    }
    catch (err) {
        throw err;
    }
}
export async function importMasters(targetMaster, objMasterInput) {
    return importData(targetMaster, objMasterInput);
}
export async function importVouchers(lstVoucher, targetCompany) {
    let objTemplateArgs = new Map();
    objTemplateArgs.set('vouchers', lstVoucher);
    if (targetCompany) {
        objTemplateArgs.set('targetCompany', targetCompany);
    }
    return importData('voucher', objTemplateArgs);
}
export async function deleteMasters(targetCollection, lstMaster, targetCompany) {
    try {
        let objTemplateArgs = new Map();
        const objCollection = lstCollectionFields.find(c => c.collection == targetCollection);
        objTemplateArgs.set('targetCollection', objCollection?.tallyType || targetCollection); //an employee is deleted as the cost centre Tally stores it as
        objTemplateArgs.set('masters', lstMaster);
        if (targetCompany) {
            objTemplateArgs.set('targetCompany', targetCompany);
        }
        let respContent = await sendTallyXml(xmlDeleteMasters, objTemplateArgs);
        return parseImportResponse(respContent);
    }
    catch (err) {
        throw err;
    }
}
export async function deleteVouchers(lstVoucher, targetCompany) {
    try {
        let objTemplateArgs = new Map();
        objTemplateArgs.set('vouchers', lstVoucher);
        if (targetCompany) {
            objTemplateArgs.set('targetCompany', targetCompany);
        }
        let respContent = await sendTallyXml(xmlDeleteVouchers, objTemplateArgs);
        return parseImportResponse(respContent);
    }
    catch (err) {
        throw err;
    }
}
/**
 * Renders a template and posts it to Tally, with timing of every phase written to the log.
 * @param conn optional host:port override, defaults to the session connection
 * @param timeoutMs optional overall budget for this call; when given, the call is a probe and is never retried
 * @param options idempotent reads are retried after a connection-level failure, writes are not
 */
async function sendTallyXml(xml, lstVariables, conn, timeoutMs, options) {
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
    }
    catch (err) {
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
async function postTallyXML(xml, conn, timeoutMs, options, renderMs) {
    const target = conn || tallyConnection;
    const idempotent = options?.idempotent === true;
    const label = options?.label || (idempotent ? 'read' : 'write');
    const isProbe = typeof timeoutMs == 'number' && timeoutMs > 0;
    const budgetMs = isProbe ? timeoutMs : tallyTimeoutMs;
    const deadline = Date.now() + budgetMs;
    const maxAttempts = isProbe ? 1 : 1 + tallyRetryMax;
    let lastError;
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
        }
        catch (err) {
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
            if (!canRetry)
                throw outcome.error;
            await sleep(backoffMs);
        }
    }
    throw lastError; // unreachable, the loop always throws or returns
}
/**
 * Error raised by a single attempt, carrying the phase timing collected so far
 */
class TallyAttemptError extends Error {
    cause_;
    timing;
    constructor(cause_, timing) {
        super(cause_ instanceof Error ? cause_.message : String(cause_));
        this.cause_ = cause_;
        this.timing = timing;
        this.name = 'TallyAttemptError';
    }
}
/**
 * Turns whatever an attempt threw into the error the caller sees, and decides whether it may be retried
 */
function classifyTransportError(err, target, idempotent, attempt) {
    let timing = err instanceof TallyAttemptError ? err.timing : undefined;
    let cause = err instanceof TallyAttemptError ? err.cause_ : err;
    let connected = timing?.connected === true;
    let headersReceived = timing?.headersReceived === true;
    let phase = headersReceived ? 'response' : (connected ? 'response' : 'connect');
    if (cause instanceof TallyTransportError)
        return { error: cause, retryable: !headersReceived && (idempotent || !connected), phase: cause.phase, code: cause.code, timing };
    let code = (cause && typeof cause == 'object' && typeof cause.code == 'string') ? cause.code : (cause instanceof Error ? cause.message : String(cause));
    if (code === 'ECONNREFUSED') {
        let error = new Error('Unable to connect to Tally. Ensure Tally is running and XML server is enabled on port ' + target.port + ' by going to Help (F1) > Settings > Connectivity in Tally and setting Client / Server configuration, set Tally Prime is action as Server');
        error.code = code;
        return { error, retryable: true, phase: 'connect', code, timing };
    }
    // connection-level failures before any response bytes: the request may be re-sent for a read;
    // for a write only when the connection was never established, so nothing could have reached Tally
    const connectionCodes = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND']);
    let isConnectionLevel = connectionCodes.has(code) || /socket hang up/i.test(code);
    if (isConnectionLevel && !headersReceived) {
        let retryable = idempotent || !connected;
        let error = new TallyTransportError(phase, code, attempt, `The connection to Tally on ${target.host}:${target.port} was ${connected ? 'dropped before Tally answered' : 'not established'}.`);
        return { error, retryable, phase, code, timing };
    }
    let error = cause instanceof Error ? cause : new Error(String(cause));
    return { error, retryable: false, phase, code, timing };
}
/**
 * One HTTP attempt against Tally with three separate deadlines: the connect deadline starts
 * when a socket is assigned (queue time waiting for a free pooled socket is not charged to it),
 * and the overall deadline caps the attempt at whatever is left of the call budget
 */
function postTallyXMLOnce(xml, target, idempotent, deadline, attempt) {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        let tSocket = 0, tConnect = 0, tHeaders = 0;
        let bytes = 0;
        let settled = false;
        let timing = { queueMs: 0, connectMs: 0, ttfbMs: 0, totalMs: 0, bytes: 0, reused: false, connected: false, headersReceived: false };
        let connectTimer;
        let budgetTimer;
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
        const finish = (err, body) => {
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
            }, (res) => {
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
                timing.reused = req.reusedSocket === true;
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
                let phase = timing.connected ? 'response' : (tSocket ? 'connect' : 'queue');
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
export async function warmTallyConnection() {
    let t0 = Date.now();
    let templateCount = 0;
    try {
        templateCount = precompileTemplates();
    }
    catch (err) {
        logWarn('warmup', 'template precompile failed', { error: err instanceof Error ? err.message : String(err) });
    }
    let tTemplates = Date.now() - t0;
    let tQuery = Date.now();
    try {
        let result = await runCollectionQuery('Company', ['Name'], new Map(), undefined, undefined, undefined, undefined, 5000);
        logInfo('warmup', 'Tally answered', { host: tallyConnection.host, port: tallyConnection.port, companies: result.rows.length, templates: templateCount, templates_ms: tTemplates, query_ms: Date.now() - tQuery, budget_ms: tallyTimeoutMs, connect_timeout_ms: tallyConnectTimeoutMs });
    }
    catch (err) {
        logWarn('warmup', 'Tally did not answer, first tool call will connect instead', { host: tallyConnection.host, port: tallyConnection.port, templates: templateCount, templates_ms: tTemplates, query_ms: Date.now() - tQuery, error: err instanceof Error ? err.message.substring(0, 160) : String(err) });
    }
}
/**
 * Checks whether a raw response body looks like it was produced by Tally's XML server.
 * Other HTTP services on the port (or non-HTTP services) never produce these envelopes
 */
function isTallyResponse(respContent) {
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
export async function probeTallyInstance(host, port, timeoutMs = 3000) {
    try {
        if (typeof host != 'string' || !host.trim() || !isValidPort(port))
            return null;
        let target = { host: host.trim(), port };
        let result = await runCollectionQuery('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map(), undefined, undefined, undefined, target, timeoutMs);
        if (!isTallyResponse(result.response))
            return null; //something answered, but it was not Tally
        let companies = result.rows
            .map(r => r['Name'])
            .filter(n => typeof n == 'string' && n.trim() != '');
        let objActive = result.rows.find(r => r['IsActiveCompany'] === true && typeof r['Name'] == 'string' && r['Name'].trim() != '');
        let booksFrom = null;
        if (objActive && objActive['BooksFrom'] instanceof Date && !isNaN(objActive['BooksFrom'].getTime()))
            booksFrom = utility.Date.format(objActive['BooksFrom'], 'yyyy-MM-dd');
        return {
            host: target.host,
            port: target.port,
            companies,
            activeCompany: objActive ? objActive['Name'] : null,
            booksFrom
        };
    }
    catch (err) {
        return null;
    }
}
/**
 * Cheap TCP connect check used to skip closed ports before the heavier XML probe
 */
function isTcpPortOpen(host, port, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        let socket = net.connect({ host, port });
        const finish = (isOpen) => {
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
export async function scanTallyInstances(host, fromPort = 9000, toPort = 9999) {
    let targetHost = (typeof host == 'string' && host.trim()) ? host.trim() : tallyConnection.host;
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
    let lstPorts = [];
    for (let p = fromPort; p <= toPort; p++)
        lstPorts.push(p);
    let lstOpenPorts = [];
    for (let i = 0; i < lstPorts.length; i += tcpConcurrency) {
        let batch = lstPorts.slice(i, i + tcpConcurrency);
        let results = await Promise.all(batch.map(p => isTcpPortOpen(targetHost, p, tcpTimeoutMs)));
        results.forEach((isOpen, idx) => {
            if (isOpen)
                lstOpenPorts.push(batch[idx]);
        });
    }
    //step 2: ask each open port whether it is Tally; non-Tally services are dropped silently
    let retval = [];
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
function extractReport(reportConfig, reportInputParams) {
    return new Promise(async (resolve, reject) => {
        let retval = {
            data: undefined
        };
        try {
            let parseString = (iStr) => {
                return utility.String.normaliseName(iStr); //decode any second-layer escaping, then strip control characters (numeric references were previously dropped as unreadable)
            };
            let parseDate = (iDate) => {
                if (/^\d\d\d\d-\d\d-\d\d$/.test(iDate))
                    return utility.Date.parse(iDate, 'yyyy-MM-dd');
                else if (/^\d?\d-\w\w\w-\d\d\d\d$/.test(iDate))
                    return utility.Date.parse(iDate, 'd-MMM-yyyy');
                else if (/^\d?\d-\w\w\w-\d\d$/.test(iDate)) {
                    return utility.Date.parse(iDate, 'd-MMM-yy');
                }
                else
                    return null;
            };
            const parseQuantity = (iStr) => {
                let regPatOutput = /^(-?\d+\.\d+|-?\d+)\s.+/g.exec(iStr);
                if (regPatOutput && typeof regPatOutput[1] == 'string' && !isNaN(parseFloat(regPatOutput[1])))
                    return parseFloat(regPatOutput[1]);
                else
                    return 0;
            };
            const parseNumber = (iNum) => {
                if (!iNum)
                    return 0;
                else
                    return parseFloat(iNum.replace(/[\(\),]+/g, ''));
            };
            const processRows = (targetObjRows, targetConfigFields) => {
                let data = [];
                let rowCount = targetObjRows.length;
                //loop through rows
                for (let r = 0; r < rowCount; r++) {
                    let o = new Object();
                    //loop through each field and extract value
                    for (const prop of targetConfigFields) {
                        let tagName = prop.name.toUpperCase();
                        let datatype = prop.datatype;
                        let fieldName = prop.name;
                        let value = undefined;
                        let _value = targetObjRows[r][tagName];
                        if (_value !== undefined) {
                            if (datatype == 'number')
                                value = parseNumber(_value);
                            else if (datatype == 'date')
                                value = parseDate(_value);
                            else if (datatype == 'boolean')
                                value = parseTallyBoolean(_value); //same coercion as collections, accepts 1/0 and Yes/No
                            else if (datatype == 'quantity')
                                value = parseQuantity(_value);
                            else
                                value = parseString(_value);
                        }
                        Object.defineProperty(o, fieldName, { enumerable: true, value });
                    }
                    //add row to array
                    data.push(o);
                }
                return data;
            };
            let tmplXML = lstReportXml.get(reportConfig.name) || '';
            let respContent = await sendTallyXml(tmplXML, reportInputParams, undefined, undefined, { idempotent: true, label: `report:${reportConfig.name}` });
            if (!respContent) {
                retval.error = 'Empty data received from Tally';
                return;
            }
            else if (respContent.startsWith('<EXCEPTION>')) {
                let regErr = respContent.match(/<EXCEPTION>(.+)<\/EXCEPTION>/g);
                let errorMessage = 'Unknown error';
                if (regErr && regErr[0])
                    errorMessage = regErr[0].substring(11, regErr[0].length - 12);
                retval.error = errorMessage;
                return;
            }
            let xmlParser = new XMLParser({
                parseTagValue: false,
                htmlEntities: true, //decode numeric character references at parse time
                isArray(tagName) {
                    return (tagName == 'ROW' || tagName.endsWith('.LIST'));
                },
            });
            // the XML parse is synchronous and blocks the event loop for its duration, so it is timed
            // to show whether a large response delays other requests
            let tParse = Date.now();
            let resultObj = xmlParser.parse(respContent);
            let data = processRows(resultObj['DATA']['ROW'], reportConfig.output);
            retval.data = data;
            let parseMs = Date.now() - tParse;
            if (parseMs >= 1000)
                logInfo('parse', 'slow report parse', { report: reportConfig.name, chars: respContent.length, rows: data.length, parse_ms: parseMs });
            else
                logDebug('parse', 'report parsed', { report: reportConfig.name, chars: respContent.length, rows: data.length, parse_ms: parseMs });
        }
        catch (err) {
            throw err;
        }
        finally {
            resolve(retval);
        }
    });
}
//# sourceMappingURL=tally.mjs.map