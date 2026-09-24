// feedback #59: Tally opens a Profit & Loss ledger at 0 for every period after the financial year start, so the
// months of a chunked ledger-account on an expense ledger never chained and the statement came back
// reconciled:false with the last month's closing. A nominal ledger is now joined as a running sum and checked
// once against Tally's whole-period closing; a Balance Sheet ledger is chained exactly as before
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { configureEnv, startMockTally, reply, requestPeriod, ledgerAccountXml, isPeriodBalanceRequest } from './helpers/mock-tally.mjs';

configureEnv({ TALLY_TIMEOUT_MS: '1500' });
const { setTallyConnection } = await import('../dist/connection.mjs');
const { fetchLedgerAccount } = await import('../dist/ledgeraccount.mjs');
const { ledgerNatureOf } = await import('../dist/ledgernature.mjs');

// the reported case: 01/04/2025 to 30/11/2025, the only movement a debit of 11,64,999 in October
const movements = [{ date: '2025-10-15', amount: -1164999 }];
const expense = { nominal: true, nature: { primaryGroup: 'Indirect Expenses', isRevenue: 'Yes' } };
const liability = { nominal: false, nature: { primaryGroup: 'Current Liabilities', isRevenue: 'No' } };
let ledger = expense;
let balanceDelayMs = 0, balanceSkew = 0;

let tally;
before(async () => {
    tally = await startMockTally((body, req, res) => {
        const { fromDate, toDate } = requestPeriod(body);
        const within = movements.filter(v => v.date >= fromDate && v.date <= toDate);
        const earlier = movements.filter(v => v.date < fromDate).reduce((s, v) => s + v.amount, 0);
        const opening = ledger.nominal ? 0 : earlier; // Tally restarts a P&L ledger at 0 after the FY start
        const closing = opening + within.reduce((s, v) => s + v.amount, 0);
        if (isPeriodBalanceRequest(body)) // the stand-in for trial-balance: Tally's own closing for the whole period
            return reply(res, ledgerAccountXml([], opening, closing + balanceSkew, fromDate, toDate, ledger.nature), balanceDelayMs);
        const vouchers = within.map((v, i) => ({ guid: `g-${v.date}-${i}`, number: String(i + 1), date: v.date, amount: v.amount.toFixed(2) }));
        reply(res, ledgerAccountXml(vouchers, opening, closing, fromDate, toDate, ledger.nature));
    });
    setTallyConnection(tally.port, '127.0.0.1');
});
after(async () => { await tally.close(); });

const params = (name) => new Map([['fromDate', '2025-04-01'], ['toDate', '2025-11-30'], ['ledgerName', name], ['targetCompany', 'Demo Co']]);
const reset = (l) => { ledger = l; balanceDelayMs = 0; balanceSkew = 0; tally.requests.length = 0; };

test('the nature is read from $IsRevenue first, then from the primary group, else unknown', () => {
    assert.equal(ledgerNatureOf({ is_revenue: 'Yes', primary_group: 'Current Liabilities' }), 'nominal');
    assert.equal(ledgerNatureOf({ is_revenue: '0', primary_group: 'Indirect Expenses' }), 'real');
    assert.equal(ledgerNatureOf({ primary_group: 'Direct Expenses' }), 'nominal');
    assert.equal(ledgerNatureOf({ primary_group: 'Sundry Creditors' }), 'real');
    assert.equal(ledgerNatureOf({ primary_group: '' }), null);
});

test('an expense ledger moving in one month of eight reconciles, closing on the whole-period figure', async () => {
    reset(expense);
    const result = await fetchLedgerAccount(params('Legal Expenses'));
    assert.equal(result.ok, true, result.error);
    assert.equal(tally.requests.length, 9); // 8 months + 1 whole-period balance
    const s = result.summary;
    assert.equal(s.reconciled, true, s.note);
    assert.equal(s.closingBalance, -1164999);
    assert.equal(s.closingBalance, s.wholePeriodClosingBalance); // what trial-balance reports for 01/04 to 30/11
    assert.equal(s.unexplainedMovement, 0);
    assert.equal(s.chunkContinuity, 'not_applicable_nominal');
    assert.equal(s.ledgerNature, 'nominal');
    assert.equal(s.wholePeriodCheck, 'matched');
    assert.equal(s.note, undefined);
    assert.equal(result.rows.at(-1).voucher_type, 'Closing');
    assert.equal(result.rows.at(-1).amount, -1164999);
    assert.equal(s.chunks[7].openingBalance, 0); // November still opens at 0, as Tally reports it
});

test('a Balance Sheet ledger over the same range is chained exactly as before', async () => {
    reset(liability);
    const result = await fetchLedgerAccount(params('Provision for Legal Fees'));
    assert.equal(result.ok, true, result.error);
    assert.equal(tally.requests.length, 8); // no whole-period request
    const s = result.summary;
    assert.equal(s.reconciled, true);
    assert.equal(s.chunkContinuity, true);
    assert.equal(s.ledgerNature, 'real');
    assert.equal(s.closingBalance, -1164999);
    assert.equal(s.chunks[7].openingBalance, -1164999);
    assert.equal(s.wholePeriodCheck, undefined);
    assert.equal(s.note, undefined);
});

test('when the whole-period check does not fit in the budget, the running sum stands on the months alone', async () => {
    reset(expense);
    balanceDelayMs = 2500; // past the 1500ms budget
    const result = await fetchLedgerAccount(params('Legal Expenses'));
    assert.equal(result.ok, true, result.error);
    const s = result.summary;
    assert.equal(s.reconciled, true);
    assert.equal(s.closingBalance, -1164999);
    assert.equal(s.wholePeriodCheck, 'not_done');
    assert.equal(s.wholePeriodClosingBalance, null);
    assert.match(s.note, /cross-check .* was not done/);
    await new Promise((r) => setTimeout(r, 1200)); // let the abandoned request finish on the mock
});

test('a running sum which disagrees with Tally\'s whole-period closing is not reconciled', async () => {
    reset(expense);
    balanceSkew = -500;
    const result = await fetchLedgerAccount(params('Legal Expenses'));
    const s = result.summary;
    assert.equal(s.reconciled, false);
    assert.equal(s.wholePeriodCheck, 'mismatch');
    assert.equal(s.runningClosingBalance, -1164999);
    assert.equal(s.closingBalance, -1165499); // Tally's own figure, so the gap shows as unexplainedMovement
    assert.equal(s.unexplainedMovement, -500);
});

test('with the nature unknown, breaks that are only "opens at 0" are called out plainly, not as incomplete', async () => {
    reset({ nominal: true, nature: { primaryGroup: '' } });
    const result = await fetchLedgerAccount(params('Legal Expenses'));
    const s = result.summary;
    assert.equal(tally.requests.length, 8);
    assert.equal(s.ledgerNature, 'unknown');
    assert.equal(s.chunkContinuity, false);
    assert.equal(s.chunkBreaksLookNominal, true);
    assert.equal(s.reconciled, false);
    assert.doesNotMatch(s.note, /incomplete/);
    assert.match(s.note, /Every month reconciles on its own/);
});
