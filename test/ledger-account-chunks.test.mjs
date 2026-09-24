// feedback #56: a ledger-account period longer than three months is fetched month by month and joined,
// reconciling opening + movements = closing across the months; names reach Tally correctly escaped
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { configureEnv, startMockTally, reply, requestPeriod, ledgerAccountXml } from './helpers/mock-tally.mjs';

configureEnv({ TALLY_TIMEOUT_MS: '1500' });
const { setTallyConnection } = await import('../dist/connection.mjs');
const { fetchLedgerAccount } = await import('../dist/ledgeraccount.mjs');
const { splitByMonth, isLongerThanMonths } = await import('../dist/period.mjs');

// an expense ledger with one journal of 1,000 on the 15th of every month, opening 0 on 01/04/2025
const monthIndex = (iso) => { const [y, m] = iso.split('-').map(Number); return (y - 2025) * 12 + m - 4; };
let delayMs = 0;
let tally;
before(async () => {
    tally = await startMockTally((body, req, res) => {
        const { fromDate, toDate } = requestPeriod(body);
        const first = monthIndex(fromDate), last = monthIndex(toDate);
        const vouchers = [];
        for (let i = first; i <= last; i++) {
            const y = 2025 + Math.floor((i + 3) / 12), mo = ((i + 3) % 12) + 1;
            vouchers.push({ guid: `g-${i}`, number: String(i + 1), date: `${y}-${String(mo).padStart(2, '0')}-15`, amount: '-1000.00' });
        }
        reply(res, ledgerAccountXml(vouchers, -1000 * first, -1000 * (last + 1), fromDate, toDate), delayMs);
    });
    setTallyConnection(tally.port, '127.0.0.1');
});
after(async () => { await tally.close(); });

const params = (fromDate, toDate, ledgerName = 'Office Expenses') => new Map([['fromDate', fromDate], ['toDate', toDate], ['ledgerName', ledgerName], ['targetCompany', 'Demo Co']]);

test('periods up to three months are one request, longer ones split into calendar months', () => {
    assert.equal(isLongerThanMonths('2025-04-01', '2025-06-30', 3), false);
    assert.equal(isLongerThanMonths('2025-04-01', '2025-07-01', 3), true);
    assert.deepEqual(splitByMonth('2025-04-10', '2025-06-05'), [
        { fromDate: '2025-04-10', toDate: '2025-04-30' },
        { fromDate: '2025-05-01', toDate: '2025-05-31' },
        { fromDate: '2025-06-01', toDate: '2025-06-05' }]);
    assert.equal(splitByMonth('2025-04-01', '2026-03-31').length, 12);
});

test('a full-year ledger-account is fetched as 12 months and joined into one reconciled statement', async () => {
    delayMs = 0;
    tally.requests.length = 0;
    const result = await fetchLedgerAccount(params('2025-04-01', '2026-03-31'));
    assert.equal(result.ok, true, result.error);
    assert.equal(tally.requests.length, 12);
    assert.equal(result.rows.length, 14); // Opening + 12 journals + Closing
    assert.equal(result.rows[0].voucher_type, 'Opening');
    assert.equal(result.rows[13].voucher_type, 'Closing');
    assert.equal(result.summary.voucherCount, 12);
    assert.equal(result.summary.openingBalance, 0);
    assert.equal(result.summary.closingBalance, -12000);
    assert.equal(result.summary.reconciled, true);
    assert.equal(result.summary.chunked, true);
    assert.equal(result.summary.chunkCount, 12);
    assert.equal(result.summary.chunkContinuity, true);
});

test('a quarter is a single request, as before', async () => {
    tally.requests.length = 0;
    const result = await fetchLedgerAccount(params('2025-04-01', '2025-06-30'));
    assert.equal(result.ok, true);
    assert.equal(tally.requests.length, 1);
    assert.equal(result.summary.chunked, undefined);
    assert.equal(result.summary.reconciled, true);
});

test('when the months do not all fit in the budget the answer is TALLY_TIMEOUT with the months to ask for next', async () => {
    delayMs = 300; // 12 x 300ms cannot fit in 1500ms
    const result = await fetchLedgerAccount(params('2025-04-01', '2026-03-31'));
    delayMs = 0;
    assert.equal(result.ok, false);
    assert.equal(result.errorDetail.code, 'TALLY_TIMEOUT');
    assert.equal(result.errorDetail.hint, 'split the period');
    assert.ok(result.errorDetail.monthsRetrieved >= 1 && result.errorDetail.monthsRetrieved < 12);
    assert.equal(result.errorDetail.suggestedPeriods[0].fromDate, '2025-04-01');
    assert.equal(result.errorDetail.suggestedPeriods.at(-1).toDate, '2026-03-31');
    await new Promise((r) => setTimeout(r, 400)); // let the abandoned month finish on the mock
});

test('ledger names with an apostrophe or a double quote reach Tally as valid XML and valid TDL', async () => {
    for (const [name, tdl] of [["Director's Remuneration", `"Director's Remuneration"`], ['12" Pipes & Fittings', `"12"" Pipes & Fittings"`]]) {
        tally.requests.length = 0;
        await fetchLedgerAccount(params('2025-04-01', '2025-04-30', name));
        const body = tally.requests[0];
        assert.equal(XMLValidator.validate(body), true, `request for ${name} is not well-formed XML`);
        const parsed = new XMLParser({ ignoreAttributes: false, htmlEntities: true, processEntities: true }).parse(body);
        const formula = JSON.stringify(parsed);
        assert.ok(formula.includes(`$$IsEqual:$LedgerName:${tdl}`.replace(/"/g, '\\"')), `TDL literal for ${name} not found`);
    }
});
