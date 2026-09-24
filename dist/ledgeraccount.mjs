import { fetchReport } from './report.mjs';
import { tallyTimeoutMs } from './tally.mjs';
import { TallyTransportError, toTimeoutDetail } from './tallyerror.mjs';
import { assembleLedgerAccount } from './ledgerstatement.mjs';
import { displayDate, groupRanges, isLongerThanMonths, splitByMonth } from './period.mjs';
// ---------------------------------------------------------------------------
// ledger-account over long periods (feedback #56)
//
// A full-year statement of a busy ledger could need longer than Tally is given, and the timeout was
// then reported as "no rows". A period longer than three months is now fetched one calendar month
// at a time, all months sharing one budget (TALLY_TIMEOUT_MS) so the tool still answers before the
// Claude relay gives up at 60s. The months are joined into one statement: the first month's Opening
// row, every voucher, the last month's Closing row; each month must reconcile on its own and its
// closing must equal the next month's opening. When the budget runs out part way, the result is a
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
    return joinChunks(lstDone);
}
function joinChunks(lstDone) {
    const isSynthetic = (r, type) => r && !r.guid && r.voucher_type === type;
    const first = lstDone[0].rows;
    const last = lstDone[lstDone.length - 1].rows;
    const opening = first.find(r => isSynthetic(r, 'Opening'));
    const closing = last.find(r => isSynthetic(r, 'Closing'));
    const vouchers = lstDone.flatMap(d => d.rows.filter(r => !isSynthetic(r, 'Opening') && !isSynthetic(r, 'Closing')));
    const merged = [...(opening ? [opening] : []), ...vouchers, ...(closing ? [closing] : [])];
    const statement = assembleLedgerAccount(merged);
    const chunks = lstDone.map(d => ({
        ...d.range,
        voucherCount: d.summary.voucherCount,
        openingBalance: d.summary.openingBalance,
        closingBalance: d.summary.closingBalance,
        reconciled: d.summary.reconciled
    }));
    const lstBreak = chunks.slice(1)
        .filter((c, i) => Math.abs(c.openingBalance - chunks[i].closingBalance) > 0.01)
        .map(c => displayDate(c.fromDate));
    const lstUnreconciled = chunks.filter(c => !c.reconciled).map(c => `${displayDate(c.fromDate)} to ${displayDate(c.toDate)}`);
    const summary = { ...statement.summary, chunked: true, chunkCount: chunks.length, chunkContinuity: lstBreak.length === 0, chunks };
    if (lstBreak.length > 0 || lstUnreconciled.length > 0) {
        summary.reconciled = false;
        summary.note = [statement.summary.note,
            lstBreak.length > 0 ? `The opening balance of the month(s) starting ${lstBreak.join(', ')} does not equal the closing balance of the month before, so the months do not chain` : '',
            lstUnreconciled.length > 0 ? `Month(s) ${lstUnreconciled.join('; ')} do not reconcile on their own (opening + vouchers differs from closing)` : ''
        ].filter(Boolean).join('. ');
    }
    return { ok: true, rows: statement.rows, summary };
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