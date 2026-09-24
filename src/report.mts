import { XMLParser } from 'fast-xml-parser';
import * as m from './models.mjs';
import { utility } from './utility.mjs';
import { lstReportConfig, lstReportXml } from './definition.mjs';
import { logDebug, logInfo } from './log.mjs';
import { parseTallyBoolean, sendTallyXml } from './tally.mjs';
import { isTallyTimeout, toTimeoutDetail, type TallyPeriod } from './tallyerror.mjs';
import { assertCompleteEnvelope } from './envelope.mjs';

const lstPullReport: m.ModelPullReportInfo[] = lstReportConfig;

export interface FetchReportOptions {
    /** absolute time (ms since epoch) by which the Tally call must finish */
    deadline?: number;
}

/**
 * Runs one of the report templates (ledger-account, stock-item-account) against Tally.
 * A transport failure (timeout, reset, aborted, empty or truncated answer) comes back as
 * error + errorDetail with code TALLY_TIMEOUT. Up to v7.8.1 such a failure was thrown inside a
 * promise executor whose finally resolved first: the caller saw data undefined, reported "Tally
 * returned no rows", and the stray rejection then killed the server process (feedback #56)
 */
export async function fetchReport(targetReport: string, inputParams: Map<string, any>, options?: FetchReportOptions): Promise<m.ModelPullResponse> {
    let retval: m.ModelPullResponse = { data: undefined };
    const period: TallyPeriod | null = inputParams.has('fromDate') || inputParams.has('toDate')
        ? { fromDate: inputParams.get('fromDate') ?? null, toDate: inputParams.get('toDate') ?? null }
        : null;

    try {
        let objReport = lstPullReport.find(p => p.name == targetReport);
        if (!objReport) {
            retval.error = 'Invalid report';
            return retval;
        }

        let lstInputs = new Map<string, any>();

        //set target company, accepting raw or escaped form
        let targetCompany = '##SVCurrentCompany';
        if (inputParams.has('targetCompany') && typeof inputParams.get('targetCompany') == 'string')
            targetCompany = utility.String.normaliseName(inputParams.get('targetCompany'));
        lstInputs.set('targetCompany', targetCompany);

        //populate input parameters value
        for (const input of objReport.input) {
            let _value = inputParams.get(input.name);

            if (input.validation_regex && typeof _value == 'string' && !new RegExp(input.validation_regex, 'i').test(_value)) {
                retval.error = input.validation_message || `Invalid value for parameter ${input.name}`;
                return retval;
            }

            if (typeof _value == 'number' && input.datatype == 'number')
                lstInputs.set(input.name, _value);
            else if (typeof _value == 'boolean' && input.datatype == 'boolean')
                lstInputs.set(input.name, _value);
            else if (typeof _value == 'string' && input.datatype == 'date' && /^\d\d-\d\d-\d\d\d\d$/.test(_value)) //Date in DD-MM-YYYY
                lstInputs.set(input.name, utility.Date.parse(_value, 'dd-MM-yyyy'));
            else if (typeof _value == 'string' && input.datatype == 'date' && /^\d\d\d\d-\d\d-\d\d/.test(_value)) //ISO DateTime YYYY-MM-DDTHH:MM:SS
                lstInputs.set(input.name, utility.Date.parse(_value.substring(0, 10), 'yyyy-MM-dd'));
            else if (typeof _value == 'string' && input.datatype == 'string')
                // names are accepted raw or escaped; a double quote is doubled because every report
                // template places the name inside a TDL string literal. XML escaping (& < > " ') is
                // applied afterwards by the template engine, so an apostrophe travels as &#39;
                lstInputs.set(input.name, utility.String.normaliseName(_value).replace(/"/g, '""'));
            else {
                retval.error = `Parameter ${input.name} not found or contains invalid value [${_value}]`;
                return retval;
            }
        }

        retval.data = await extractReport(objReport, lstInputs, options);
    } catch (err) {
        if (isTallyTimeout(err)) {
            retval.errorDetail = toTimeoutDetail(err, period);
            retval.error = JSON.stringify(retval.errorDetail);
        }
        else
            retval.error = err instanceof Error ? err.message : (typeof err == 'string' ? err : 'Server exception');
        retval.data = undefined;
    }
    return retval;
}

function parseDate(iDate: string): Date | null {
    if (/^\d\d\d\d-\d\d-\d\d$/.test(iDate))
        return utility.Date.parse(iDate, 'yyyy-MM-dd');
    else if (/^\d?\d-\w\w\w-\d\d\d\d$/.test(iDate))
        return utility.Date.parse(iDate, 'd-MMM-yyyy');
    else if (/^\d?\d-\w\w\w-\d\d$/.test(iDate))
        return utility.Date.parse(iDate, 'd-MMM-yy');
    return null;
}

function parseQuantity(iStr: string): number {
    let regPatOutput = /^(-?\d+\.\d+|-?\d+)\s.+/g.exec(iStr);
    return regPatOutput && !isNaN(parseFloat(regPatOutput[1])) ? parseFloat(regPatOutput[1]) : 0;
}

function parseNumber(iNum: string): number {
    return iNum ? parseFloat(iNum.replace(/[\(\),]+/g, '')) : 0;
}

function processRows(lstRow: any[], lstField: m.ModelPullReportOutputFieldInfo[]): any[] {
    return lstRow.map((row) => {
        let o: any = {};
        for (const prop of lstField) {
            let _value = row ? row[prop.name.toUpperCase()] : undefined;
            let value: any = undefined;
            if (_value !== undefined) {
                if (prop.datatype == 'number')
                    value = parseNumber(_value);
                else if (prop.datatype == 'date')
                    value = parseDate(_value);
                else if (prop.datatype == 'boolean')
                    value = parseTallyBoolean(_value); //same coercion as collections, accepts 1/0 and Yes/No
                else if (prop.datatype == 'quantity')
                    value = parseQuantity(_value);
                else
                    value = utility.String.normaliseName(_value); //decode any second-layer escaping, then strip control characters
            }
            Object.defineProperty(o, prop.name, { enumerable: true, value });
        }
        return o;
    });
}

async function extractReport(reportConfig: m.ModelPullReportInfo, reportInputParams: Map<string, any>, options?: FetchReportOptions): Promise<any[]> {
    let tmplXML = lstReportXml.get(reportConfig.name) || '';
    let respContent = await sendTallyXml(tmplXML, reportInputParams, undefined, undefined, { idempotent: true, label: `report:${reportConfig.name}`, deadline: options?.deadline });

    assertCompleteEnvelope(respContent, true); //empty or cut-short answers are TALLY_TIMEOUT, not "no rows"

    let body = respContent.replace(/^﻿/, '').trim();
    if (body.startsWith('<EXCEPTION>')) {
        let regErr = body.match(/<EXCEPTION>([\s\S]+?)<\/EXCEPTION>/);
        throw new Error(utility.String.unescapeHTML(regErr ? regErr[1] : 'Unknown error received from Tally'));
    }
    if (!/^<DATA\b/i.test(body))
        throw new Error(`Tally answered with something other than report data: ${utility.String.unescapeHTML(body).substring(0, 300)}`);

    let xmlParser = new XMLParser({
        parseTagValue: false,
        htmlEntities: true, //decode numeric character references at parse time
        isArray(tagName) {
            return (tagName == 'ROW' || tagName.endsWith('.LIST'));
        },
    });
    // the XML parse is synchronous and blocks the event loop for its duration, so it is timed
    let tParse = Date.now();
    let resultObj = xmlParser.parse(body);
    let lstRow: any[] = resultObj && resultObj['DATA'] && Array.isArray(resultObj['DATA']['ROW']) ? resultObj['DATA']['ROW'] : []; //a whole DATA envelope without ROW is a genuine "no rows"
    let data = processRows(lstRow, reportConfig.output);
    let parseMs = Date.now() - tParse;
    let fields = { report: reportConfig.name, chars: body.length, rows: data.length, parse_ms: parseMs };
    if (parseMs >= 1000)
        logInfo('parse', 'slow report parse', fields);
    else
        logDebug('parse', 'report parsed', fields);
    return data;
}
