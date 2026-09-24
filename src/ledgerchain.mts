import { assembleLedgerAccount } from './ledgerstatement.mjs';
import { ledgerNatureOf, type LedgerNature } from './ledgernature.mjs';
import { displayDate, type PeriodRange } from './period.mjs';

// ---------------------------------------------------------------------------
// Joining the months of a chunked ledger-account into one statement (feedback #56, #59)
//
// A Balance Sheet (real) ledger carries its balance forward, so each month's closing must equal the next
// month's opening and the statement closes on the last month's closing. A Profit & Loss (nominal) ledger
// does not: Tally reports an opening of 0 for any period starting after the financial year start, so
// chaining its months always "broke" and the last month's closing (that month's movement alone) was
// taken as the closing of the whole period (feedback #59). A nominal ledger is therefore joined as a
// running sum, opening of the first month plus every voucher, and checked once against the closing
// Tally reports for the whole period
// ---------------------------------------------------------------------------

export interface ChunkDone { range: PeriodRange, rows: any[], summary: Record<string, any> }

/** the closing Tally reports for the whole period, or why it could not be had */
export type WholePeriodBalance = { closing: number } | { notDone: string };

interface ChunkSummary extends PeriodRange {
    voucherCount: number;
    openingBalance: number;
    closingBalance: number;
    reconciled: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isSynthetic = (r: any, type: string) => r && !r.guid && r.voucher_type === type;
const isVoucher = (r: any) => !isSynthetic(r, 'Opening') && !isSynthetic(r, 'Closing');
const spanOf = (c: PeriodRange) => `${displayDate(c.fromDate)} to ${displayDate(c.toDate)}`;

/** nature of the ledger, read from the first month whose Closing row resolves it */
export function natureOfChunks(lstDone: ChunkDone[]): LedgerNature {
    for (const d of lstDone) {
        const nature = ledgerNatureOf(d.rows.find(r => isSynthetic(r, 'Closing')));
        if (nature) return nature;
    }
    return null;
}

function summarise(lstDone: ChunkDone[]): { chunks: ChunkSummary[], lstUnreconciled: string[] } {
    const chunks: ChunkSummary[] = lstDone.map(d => ({
        ...d.range,
        voucherCount: d.summary.voucherCount,
        openingBalance: d.summary.openingBalance,
        closingBalance: d.summary.closingBalance,
        reconciled: d.summary.reconciled
    }));
    return { chunks, lstUnreconciled: chunks.filter(c => !c.reconciled).map(spanOf) };
}

const unreconciledNote = (lst: string[]) => lst.length > 0 ? `Month(s) ${lst.join('; ')} do not reconcile on their own (opening + vouchers differs from closing)` : '';

/** Balance Sheet ledger, or one whose nature could not be read: each month must chain to the next */
export function joinChained(lstDone: ChunkDone[], nature: LedgerNature): { rows: any[], summary: Record<string, any> } {
    const opening = lstDone[0].rows.find(r => isSynthetic(r, 'Opening'));
    const closing = lstDone[lstDone.length - 1].rows.find(r => isSynthetic(r, 'Closing'));
    const vouchers = lstDone.flatMap(d => d.rows.filter(isVoucher));
    const statement = assembleLedgerAccount([...(opening ? [opening] : []), ...vouchers, ...(closing ? [closing] : [])]);

    const { chunks, lstUnreconciled } = summarise(lstDone);
    const lstBreakIdx = chunks.slice(1).map((c, i) => i + 1).filter(i => Math.abs(chunks[i].openingBalance - chunks[i - 1].closingBalance) > 0.01);
    const lstBreak = lstBreakIdx.map(i => displayDate(chunks[i].fromDate));

    const summary: Record<string, any> = { ...statement.summary, chunked: true, chunkCount: chunks.length, chunkContinuity: lstBreak.length === 0, ledgerNature: nature ?? 'unknown', chunks };
    if (lstBreak.length === 0 && lstUnreconciled.length === 0)
        return { rows: statement.rows, summary };

    summary.reconciled = false;
    // nature unknown, yet every break is "opens at 0 after a month which closed non-zero": the pattern of a
    // Profit & Loss ledger, not of missing rows, so it is said plainly instead of calling the statement incomplete
    const looksNominal = nature === null && lstUnreconciled.length === 0 && lstBreakIdx.length > 0
        && lstBreakIdx.every(i => Math.abs(chunks[i].openingBalance) <= 0.01 && Math.abs(chunks[i - 1].closingBalance) > 0.01);
    if (looksNominal) {
        summary.chunkBreaksLookNominal = true;
        summary.note = `Every month reconciles on its own. The months do not chain only because the month(s) starting ${lstBreak.join(', ')} open at 0 after a month which closed at a non-zero balance, which is how Tally reports a Profit & Loss ledger (it restarts such a ledger at 0 for any period after the start of the financial year). Whether this ledger is Profit & Loss or Balance Sheet could not be read from Tally, so its months were not added up as a running sum and closingBalance is the last month's closing alone, not the closing of the whole period. This is not evidence of missing entries: take the whole-period closing from trial-balance for the same period`;
        return { rows: statement.rows, summary };
    }
    summary.note = [statement.summary.note,
        lstBreak.length > 0 ? `The opening balance of the month(s) starting ${lstBreak.join(', ')} does not equal the closing balance of the month before, so the months do not chain` : '',
        unreconciledNote(lstUnreconciled)
    ].filter(Boolean).join('. ');
    return { rows: statement.rows, summary };
}

/** Profit & Loss ledger: opening of the first month plus every voucher, checked once against the whole period */
export function joinRunningSum(lstDone: ChunkDone[], whole: WholePeriodBalance): { rows: any[], summary: Record<string, any> } {
    const opening = lstDone[0].rows.find(r => isSynthetic(r, 'Opening'));
    const lastClosing = lstDone[lstDone.length - 1].rows.find(r => isSynthetic(r, 'Closing'));
    const vouchers = lstDone.flatMap(d => d.rows.filter(isVoucher));
    const { chunks, lstUnreconciled } = summarise(lstDone);

    const runningClosing = round2(chunks[0].openingBalance + vouchers.reduce((s, r) => s + (typeof r.amount === 'number' && !isNaN(r.amount) ? r.amount : 0), 0));
    const checked = 'closing' in whole;
    const matched = checked && Math.abs(whole.closing - runningClosing) <= 0.01;
    // on a mismatch the Closing row carries Tally's own whole-period figure, so unexplainedMovement shows the gap
    const closingAmount = checked && !matched ? whole.closing : runningClosing;
    const closing = lastClosing ? { ...lastClosing, amount: closingAmount } : undefined;
    const statement = assembleLedgerAccount([...(opening ? [opening] : []), ...vouchers, ...(closing ? [closing] : [])]);

    const summary: Record<string, any> = {
        ...statement.summary, chunked: true, chunkCount: chunks.length, chunkContinuity: 'not_applicable_nominal', ledgerNature: 'nominal',
        runningClosingBalance: runningClosing, wholePeriodClosingBalance: checked ? whole.closing : null,
        wholePeriodCheck: checked ? (matched ? 'matched' : 'mismatch') : 'not_done', chunks
    };
    summary.reconciled = statement.summary.reconciled && lstUnreconciled.length === 0 && (!checked || matched);
    const lstNote = [
        statement.summary.note,
        checked && !matched ? `This is a Profit & Loss ledger, so its months were added up as a running sum (opening ${chunks[0].openingBalance} plus every voucher = ${runningClosing}), but Tally reports ${whole.closing} as the closing for the whole period; the difference of ${round2(whole.closing - runningClosing)} is not explained by the rows returned` : '',
        !checked ? `This is a Profit & Loss ledger, so its months were added up as a running sum rather than chained (Tally opens such a ledger at 0 for every period after the start of the financial year). The whole-period cross-check against Tally's own closing was not done (${whole.notDone}), so reconciled rests on each month reconciling on its own; confirm closingBalance with trial-balance for the same period` : '',
        unreconciledNote(lstUnreconciled)
    ].filter(Boolean);
    if (lstNote.length > 0) summary.note = lstNote.join('. ');
    else delete summary.note;
    return { rows: statement.rows, summary };
}
