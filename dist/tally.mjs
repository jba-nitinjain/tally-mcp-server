import http from 'node:http';
import net from 'node:net';
import nunjucks from 'nunjucks';
import { XMLParser } from 'fast-xml-parser';
import { utility } from './utility.mjs';
import { lstCollectionFields, lstPushXml, lstReportConfig, lstReportXml, xmlInvokeAction, xmlQueryCollection, xmlDeleteMasters, xmlDeleteVouchers } from './definition.mjs';
const default_tally_port = parseInt(process.env.TALLY_PORT || '9000') || 9000; // default to 9000 XML port of Tally
const default_tally_host = process.env.TALLY_HOST || 'localhost'; // default to localhost
const lstPullReport = lstReportConfig;
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
                targetCompany = inputParams.get('targetCompany'); //extract from request object
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
                    lstInputs.set(iName, _value);
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
        retval.error = 'Server exception';
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
            objTemplateArgs.set('targetCompany', targetCompany);
        if (fromDate)
            objTemplateArgs.set('fromDate', fromDate);
        if (toDate)
            objTemplateArgs.set('toDate', toDate);
        objTemplateArgs.set('collection', targetCollection);
        let objCollection = lstCollectionFields.filter(c => c.collection == targetCollection)[0]; //load collection definition
        let lstQueryFields = objCollection.fields.filter(f => lstFields.includes(f.name)); //filter fields based on user query
        objTemplateArgs.set('fields', lstQueryFields); //filter fields queried by user
        if (lstFilters && lstFilters.size > 0) {
            let objFilters = [];
            for (const [k, v] of lstFilters.entries()) {
                objFilters.push({
                    name: k,
                    expression: v
                });
            }
            objTemplateArgs.set('filters', objFilters); //add filters to template arguments
        }
        let respContent = await sendTallyXml(xmlQueryCollection, objTemplateArgs, conn, timeoutMs); //send XML to Tally and get response
        let xmlParser = new XMLParser({
            parseTagValue: false,
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
                        value = _value == 'Yes';
                    else if (field.datatype == 'number' || field.datatype == 'amount' || field.datatype == 'quantity' || field.datatype == 'rate')
                        value = parseFloat(_value);
                    else if (field.datatype == 'date')
                        value = utility.Date.parse(_value, 'yyyy-MM-dd');
                    else
                        value = utility.String.unescapeHTML(_value);
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
    const xmlParser = new XMLParser({ parseTagValue: false });
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
        objTemplateArgs.set('targetCollection', targetCollection);
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
async function sendTallyXml(xml, lstVariables, conn, timeoutMs) {
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
        let xmlRequest = nEnv.renderString(xml, o);
        let xmlResponse = await postTallyXML(xmlRequest, conn, timeoutMs);
        return xmlResponse;
    }
    catch (err) {
        throw err;
    }
}
/**
 * Posts XML to Tally. The session connection is read on every call so a runtime change
 * takes effect immediately; a caller may target a specific host:port instead (used by port probes)
 * @param conn optional host:port override, defaults to the session connection
 * @param timeoutMs optional socket inactivity timeout after which the request is aborted
 */
async function postTallyXML(xml, conn, timeoutMs) {
    return new Promise((resolve, reject) => {
        try {
            let target = conn || tallyConnection;
            let req = http.request({
                hostname: target.host,
                port: target.port,
                path: '',
                method: 'POST',
                headers: {
                    'Content-Length': Buffer.byteLength(xml, 'utf16le'),
                    'Content-Type': 'text/xml;charset=utf-16'
                }
            }, (res) => {
                let data = '';
                res
                    .setEncoding('utf16le')
                    .on('data', (chunk) => {
                    let result = chunk.toString() || '';
                    data += result;
                })
                    .on('end', () => {
                    resolve(data);
                })
                    .on('error', (httpErr) => {
                    reject(httpErr);
                });
            });
            if (typeof timeoutMs == 'number' && timeoutMs > 0)
                req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
            req.on('error', (reqError) => {
                let errorType = reqError['code'] || reqError['message'];
                if (errorType === 'ECONNREFUSED')
                    reject('Unable to connect to Tally. Ensure Tally is running and XML server is enabled on port ' + target.port + ' by going to Help (F1) > Settings > Connectivity in Tally and setting Client / Server configuration, set Tally Prime is action as Server');
                else
                    reject(reqError);
            });
            req.write(xml, 'utf16le');
            req.end();
        }
        catch (err) {
            reject(err);
        }
    });
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
                iStr = utility.String.unescapeHTML(iStr);
                iStr = iStr.replace(/&#\d+;/g, ''); //remove unreadable characters;
                return iStr;
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
                                value = _value == '1';
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
            let respContent = await sendTallyXml(tmplXML, reportInputParams);
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
                isArray(tagName) {
                    return (tagName == 'ROW' || tagName.endsWith('.LIST'));
                },
            });
            let resultObj = xmlParser.parse(respContent);
            let data = processRows(resultObj['DATA']['ROW'], reportConfig.output);
            retval.data = data;
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