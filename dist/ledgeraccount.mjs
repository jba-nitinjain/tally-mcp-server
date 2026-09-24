import { fetchReport } from './report.mjs';
import { tallyTimeoutMs } from './tally.mjs';
import { TallyTransportError, toTimeoutDetail } from './tallyerror.mjs';
import { assembleLedgerAccount } from './ledgerstatement.mjs';
import { joinChained, joinRunningSum, natureOfChunks } from './ledgerchain.mjs';
import { displayDate, groupRanges, isLongerThanMonths, splitByMonth } from './period.mjs';
// ---------------------------------------------------------------------------
// ledger-account over long periods (feedback #56)
//
// A full-year statement of a busy ledger could need longer than Tally is given, and the timeout was
// then reported as "no rows". A period longer than three months is now fetched one calendar month
// at a time, all months sharing one budget (TALLY_TIMEOUT_MS) so the tool still answers before the
// Claude relay gives up at 60s. The months are joined into one statement (ledgerchain.mts): a Balance
// Sheet ledger's months must chain, a Profit & Loss ledger's are added up as a running sum and checked
// once against Tally's whole-period closing (feedback #59). When the budget runs out part way, the result is a
// TALLY_TIMEOUT error naming the months retrieved and suggesting shorter periods, never a partial
// statement and never "no rows"
// ---------------------------------------------------------------------------
export const chunkThresholdMonths = 3;
export async function fetchLedgerAccount(inputParams, fetcher = fetchReport) {
    const fromDate = String(inputParams.get('fromDate'));
    const toDate = String(inputParams.get('toDate'));
    if (!isLongerThanMonths(fromDate, toDate, chunkThresholdMonths)) {
        const resp = await fetcher('ledger-account', inputParams);
        if (resp.error)
            return { ok: false, error: resp.error, errorDetail: resp.errorDetail };
        const statement = assembleLedgerAccount(Array.isArray(resp.data) ? resp.data : []);
        return { ok: true, rows: statement.rows, summary: statement.summary };
    }
    const lstChunk = splitByMonth(fromDate, toDate);
    const t0 = Date.now();
    const deadline = t0 + tallyTimeoutMs;
    const lstDone = [];
    for (const range of lstChunk) {
        let resp;
        if (Date.now() >= deadline - 250)
            resp = { data: undefined, errorDetail: toTimeoutDetail(new TallyTransportError('queue', 'budget-exhausted', 1, 'The time allowed for this call ran out before this month could be requested.'), range) };
        else
            resp = await fetcher('ledger-account', new Map(inputParams).set('fromDate', range.fromDate).set('toDate', range.toDate), { deadline });
        if (resp.errorDetail)
            return chunkTimeout(resp.errorDetail, { fromDate, toDate }, range, lstChunk, lstDone.map(d => d.range), Date.now() - t0);
        if (resp.error)
            return { ok: false, error: `Month ${displayDate(range.fromDate)} to ${displayDate(range.toDate)} of the requested period failed: ${resp.error}` };
        const statement = assembleLedgerAccount(Array.isArray(resp.data) ? resp.data : []);
        lstDone.push({ range, rows: statement.rows, summary: statement.summary });
    }
    // feedback #59: a Profit & Loss ledger restarts at 0 every month, so its months are added up, not chained
    const nature = natureOfChunks(lstDone);
    const joined = nature === 'nominal'
        ? joinRunningSum(lstDone, await fetchWholePeriodBalance(inputParams, fetcher, deadline))
        : joinChained(lstDone, nature);
    return { ok: true, rows: joined.rows, summary: joined.summary };
}
/** the closing Tally reports for the whole period, fetched without vouchers, within what is left of the budget */
async function fetchWholePeriodBalance(inputParams, fetcher, deadline) {
    if (Date.now() >= deadline - 250)
        return { notDone: 'the time allowed for this call had run out' };
    const resp = await fetcher('ledger-period-balance', inputParams, { deadline });
    if (resp.errorDetail)
        return { notDone: 'Tally did not answer within the time allowed' };
    if (resp.error)
        return { notDone: `Tally answered ${resp.error}` };
    const closing = (Array.isArray(resp.data) ? resp.data : []).find(r => r && !r.guid && r.voucher_type === 'Closing');
    if (!closing || typeof closing.amount !== 'number' || isNaN(closing.amount))
        return { notDone: 'Tally did not return a closing balance for the whole period' };
    return { closing: closing.amount };
}
function chunkTimeout(detail, period, failed, lstChunk, lstDone, elapsedMs) {
    const remaining = lstChunk.filter(c => c.fromDate >= failed.fromDate);
    const suggestedPeriods = [
        ...(lstDone.length > 0 ? [{ fromDate: lstDone[0].fromDate, toDate: lstDone[lstDone.length - 1].toDate }] : []),
        ...groupRanges(remaining, remaining.length > 3 ? 3 : 1)
    ];
    const message = `ledger-account for ${displayDate(period.fromDate)} to ${displayDate(period.toDate)} was fetched month by month, and Tally did not deliver the month ${displayDate(failed.fromDate)} to ${displayDate(failed.toDate)} within the time allowed (${lstDone.length} of ${lstChunk.length} months were retrieved in ${Math.round(elapsedMs / 1000)}s). No statement is returned, because a partial one would read as missing activity. Split the period and call ledger-account once for each of suggestedPeriods; Tally may stay busy for up to a minute finishing the abandoned month. ${detail.message}`;
    const errorDetail = { ...detail, elapsedMs, period, failedPeriod: failed, monthsRetrieved: lstDone.length, monthsRequested: lstChunk.length, suggestedPeriods, message };
    return { ok: false, error: JSON.stringify(errorDetail), errorDetail };
}
//# sourceMappingURL=ledgeraccount.mjs.map