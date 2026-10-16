// voucher-delete keeps to the budget of a call: a lookup Tally does not answer in time deletes nothing, and
// vouchers which no longer fit once a slow deletion has used the time are reported as not_attempted
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureEnv, startMockTally } from './helpers/mock-tally.mjs';
import { createMockBooks, guidOf } from './helpers/mock-books.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = configureEnv({ TALLY_TIMEOUT_MS: '2000' });
const mock = createMockBooks();

const G1 = guidOf(31583);
const G3 = guidOf(31584);
let objectArrivedAt = 0;
let importArrivedAt = 0;

// timestamps of the first lookup and the first post to reach Tally, so that the start up of the child process does not count
const handle = (body, req, res) => {
    if (body.includes('<TYPE>Object</TYPE>')) objectArrivedAt ||= Date.now();
    if (body.includes('<TALLYREQUEST>Import Data</TALLYREQUEST>') && body.includes('ACTION="Create"')) importArrivedAt ||= Date.now();
    return mock.handle(body, req, res);
};

before(async () => { globalThis.tally = await startMockTally(handle); });
after(async () => { await globalThis.tally.close(); });
beforeEach(() => {
    mock.load([
        { masterId: 31583, type: 'Journal', number: '243', date: '2025-04-30' },
        { masterId: 31584, type: 'Journal', number: '244', date: '2025-04-30' }
    ]);
    objectArrivedAt = 0;
    importArrivedAt = 0;
});

async function callTool(tool, args) {
    const { stdout } = await run(process.execPath, [path.join(here, 'helpers', 'call-tool.mjs'), tool, JSON.stringify(args)], {
        env: { ...process.env, TALLY_PORT: String(globalThis.tally.port), TALLY_STATE_DIR: stateDir }
    });
    return JSON.parse(stdout);
}

test('a lookup which Tally does not answer in time deletes nothing and answers within the budget', async () => {
    mock.state.options.objectDelayMs = 3000;
    const result = await callTool('voucher-delete', { targetCompany: 'Demo Co', vouchers: [{ guid: G1 }] });
    assert.ok(Date.now() - objectArrivedAt < 3500, `answered ${Date.now() - objectArrivedAt}ms after the lookup was sent`);
    assert.equal(result.isError, true);
    assert.match(result.text, /did not answer the voucher lookup in time, so nothing was deleted/);
    assert.equal(mock.state.imports.length, 0);
});

test('a slow deletion leaves the later vouchers not_attempted, and its own result unconfirmed', async () => {
    mock.state.options.deleteDelayMs = (n) => (n === 1 ? 1600 : 0);
    const result = await callTool('voucher-delete', { targetCompany: 'Demo Co', vouchers: [{ guid: G1 }, { guid: G3 }] });
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.equal(result.vouchers[0].status, 'deleted');
    assert.equal(result.vouchers[0].confirmed, null);
    assert.equal(result.vouchers[1].status, 'not_attempted');
    assert.equal(result.notAttempted, 1);
    assert.equal(mock.state.imports.length, 1);
});

test('voucher-create-update keeps to the budget too: a post Tally does not answer in time is reported as unknown, not retried', async () => {
    mock.state.options.createDelayMs = 3000; // answers long after the 2000ms budget
    const result = await callTool('voucher-create-update', { targetCompany: 'Demo Co', vouchers: [{ date: '2025-04-30', voucherType: 'Journal', ledgerEntries: [{ ledgerName: 'Cash', amount: 290 }, { ledgerName: 'Office Expenses', amount: -290 }] }, { date: '2025-04-30', voucherType: 'Journal', ledgerEntries: [{ ledgerName: 'Cash', amount: 10 }, { ledgerName: 'Office Expenses', amount: -10 }] }] });
    assert.ok(Date.now() - importArrivedAt < 2500, `answered ${Date.now() - importArrivedAt}ms after the post was sent`);
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.match(result.text, /did not answer in time for voucher 1 of 2/);
    assert.match(result.text, /not known whether it was saved/);
    assert.equal(mock.state.imports.length, 1);
});
