// Regression test for feedback #56: a Tally which answers too late, resets the connection or cuts its
// answer short must surface as TALLY_TIMEOUT, never as "Tally returned no rows", and must not end the process
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { configureEnv, startMockTally, reply } from './helpers/mock-tally.mjs';

configureEnv({ TALLY_TIMEOUT_MS: '800' });
const { setTallyConnection } = await import('../dist/connection.mjs');
const { fetchReport } = await import('../dist/report.mjs');
const { fetchLedgerAccount } = await import('../dist/ledgeraccount.mjs');

const rejections = [];
process.on('unhandledRejection', (reason) => rejections.push(reason));

let mode = 'delay';
let tally;
before(async () => {
    tally = await startMockTally((body, req, res) => {
        if (mode == 'delay') return reply(res, '<DATA></DATA>', 3000); // answers long after the 800ms budget
        if (mode == 'reset') return req.socket.destroy();
        if (mode == 'aborted') { res.writeHead(200, { 'Content-Length': 4000 }); res.write(Buffer.from('<DATA><ROW>', 'utf16le')); return setTimeout(() => req.socket.destroy(), 50); }
        if (mode == 'truncated') { res.writeHead(200, { Connection: 'close' }); return res.end(Buffer.from('<DATA><ROW><GUID>x</GUID>', 'utf16le')); }
        if (mode == 'empty') return reply(res, '');
        if (mode == 'no-rows') return reply(res, '<DATA></DATA>');
    });
    setTallyConnection(tally.port, '127.0.0.1');
});
after(async () => { await tally.close(); });

const params = (fromDate, toDate) => new Map([['fromDate', fromDate], ['toDate', toDate], ['ledgerName', 'Office Expenses'], ['targetCompany', 'Demo Co']]);

test('a report Tally does not answer within the budget is TALLY_TIMEOUT, not no rows', async () => {
    mode = 'delay';
    const resp = await fetchReport('ledger-account', params('2025-04-01', '2025-06-30'));
    assert.equal(resp.data, undefined);
    assert.equal(resp.errorDetail?.code, 'TALLY_TIMEOUT');
    assert.equal(resp.errorDetail.reason, 'timeout');
    assert.equal(resp.errorDetail.hint, 'split the period');
    assert.deepEqual(resp.errorDetail.period, { fromDate: '2025-04-01', toDate: '2025-06-30' });
    assert.ok(resp.errorDetail.elapsedMs >= 700 && resp.errorDetail.elapsedMs < 2500, `elapsedMs ${resp.errorDetail.elapsedMs}`);
    assert.equal(JSON.parse(resp.error).code, 'TALLY_TIMEOUT');
    assert.doesNotMatch(resp.error, /no rows/i);
});

test('a full-year ledger-account on a Tally that does not answer returns TALLY_TIMEOUT, never an empty statement', async () => {
    mode = 'delay';
    const result = await fetchLedgerAccount(params('2025-04-01', '2026-03-31'));
    assert.equal(result.ok, false);
    assert.equal(result.errorDetail.code, 'TALLY_TIMEOUT');
    assert.deepEqual(result.errorDetail.period, { fromDate: '2025-04-01', toDate: '2026-03-31' });
    assert.equal(result.errorDetail.monthsRetrieved, 0);
    assert.ok(result.errorDetail.suggestedPeriods.length > 0);
});

for (const [m, reason] of [['reset', 'reset'], ['aborted', 'aborted'], ['truncated', 'truncated-response'], ['empty', 'empty-response']]) {
    test(`a ${m} answer is TALLY_TIMEOUT (${reason})`, async () => {
        mode = m;
        const resp = await fetchReport('ledger-account', params('2025-04-01', '2025-04-30'));
        assert.equal(resp.errorDetail?.code, 'TALLY_TIMEOUT', resp.error);
        assert.equal(resp.errorDetail.reason, reason);
    });
}

test('a well-formed envelope with no rows is a genuine empty result', async () => {
    mode = 'no-rows';
    const resp = await fetchReport('ledger-account', params('2025-04-01', '2025-04-30'));
    assert.equal(resp.error, undefined);
    assert.deepEqual(resp.data, []);
});

test('no failure escaped as an unhandled rejection (which used to end the server process)', async () => {
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(rejections, []);
});
