// voucher-create-update on an existing voucher (guid supplied) against a mock Tally.ERP 9 (test/helpers/mock-books.mjs): Tally finds the voucher
// by its current date, type and number, never by its guid (an Alter aimed at a guid saved a duplicate), the number is read again just
// before the post, and every change is read back
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
const stateDir = configureEnv();
const mock = createMockBooks();

const G1 = guidOf(31583);
const G2 = guidOf(31575);
const R2 = guidOf(0x7a5b);
const G3 = guidOf(31584);

const freshBooks = () => mock.load([
    { masterId: 31583, type: 'Journal', number: '243', date: '2025-04-30' },
    { masterId: 31575, type: 'Payment', number: '115', date: '2025-04-15', remoteGuid: R2 },
    { masterId: 31584, type: 'Journal', number: '244', date: '2025-04-30' }
]);

before(async () => { globalThis.tally = await startMockTally(mock.handle); });
after(async () => { await globalThis.tally.close(); });
beforeEach(() => freshBooks());

async function callTool(tool, args) {
    const { stdout } = await run(process.execPath, [path.join(here, 'helpers', 'call-tool.mjs'), tool, JSON.stringify(args)], {
        env: { ...process.env, TALLY_PORT: String(globalThis.tally.port), TALLY_STATE_DIR: stateDir }
    });
    return JSON.parse(stdout);
}
const journal = (extra) => ({ date: '2025-04-30', voucherType: 'Journal', ledgerEntries: [{ ledgerName: 'Cash', amount: 290 }, { ledgerName: 'Office Expenses', amount: -290 }], ...extra });
const write = (vouchers) => callTool('voucher-create-update', { targetCompany: 'Demo Co', vouchers });

test('a voucher moved to a new date is found by its old date and number, keeps its number, and is read back', async () => {
    const alterIdBefore = mock.state.books.get(31583).alterId;
    const size = mock.state.books.size;
    const result = await write([journal({ guid: G1, date: '2025-05-16', narration: 'x' })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.altered, 1);
    assert.equal(result.created, 0);
    assert.equal(mock.state.imports.length, 1);
    assert.match(mock.state.imports[0], /<VOUCHER DATE="30-Apr-2025" TAGNAME="Voucher Number" TAGVALUE="243" VCHTYPE="Journal" ACTION="Alter"/);
    assert.match(mock.state.imports[0], /<DATE>20250516<\/DATE>/);
    assert.match(mock.state.imports[0], /<VOUCHERNUMBER>243<\/VOUCHERNUMBER>/);
    assert.doesNotMatch(mock.state.imports[0], /REMOTEID/);
    assert.deepEqual(result.vouchers, [{ action: 'altered', guid: G1, date: '2025-05-16', voucherType: 'Journal', voucherNumber: '243', confirmed: true }]);
    const voucher = mock.state.books.get(31583);
    assert.equal(voucher.date, '2025-05-16');
    assert.equal(voucher.number, '243');
    assert.ok(voucher.alterId > alterIdBefore);
    assert.equal(mock.state.books.size, size, 'no duplicate voucher');
});

test('a new voucher number is sent in the body while the voucher is found by its current number', async () => {
    const result = await write([journal({ guid: G1, voucherNumber: '300' })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.match(mock.state.imports[0], /TAGVALUE="243"/);
    assert.match(mock.state.imports[0], /<VOUCHERNUMBER>300<\/VOUCHERNUMBER>/);
    assert.equal(result.vouchers[0].voucherNumber, '300');
    assert.equal(mock.state.books.get(31583).number, '300');
});

test('a voucher which carries a remote id is altered by its number, without a duplicate', async () => {
    const size = mock.state.books.size;
    const result = await write([journal({ guid: G2, voucherType: 'Payment', date: '2025-04-15' })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.altered, 1);
    assert.equal(result.created, 0);
    assert.match(mock.state.imports[0], /TAGVALUE="115" VCHTYPE="Payment" ACTION="Alter"/);
    assert.doesNotMatch(mock.state.imports[0], /REMOTEID/);
    assert.equal(mock.state.books.size, size);
    assert.equal(result.vouchers[0].confirmed, true);
});

test('a change of the voucher type is refused before anything is posted', async () => {
    const result = await write([journal({ guid: G1, voucherType: 'Payment' })]);
    assert.equal(result.isError, true);
    assert.match(result.text, /cannot be changed/);
    assert.equal(mock.state.imports.length, 0);
});

test('a voucher whose number another voucher of its type shares that day is refused', async () => {
    mock.state.books.set(31590, { masterId: 31590, guid: guidOf(31590), remoteGuid: '', type: 'Journal', number: '243', date: '2025-04-30', alterId: 1, narration: '', optional: true });
    const result = await write([journal({ guid: G1 })]);
    assert.equal(result.isError, true);
    assert.match(result.text, /carry number 243/);
    assert.equal(mock.state.imports.length, 0);
});

test('a correction which Tally saves as a new voucher stops the call and names the new voucher', async () => {
    mock.state.options.alterCreates = true;
    const result = await write([journal({ guid: G1 }), journal({ guid: G3 })]);
    assert.equal(result.isError, true);
    assert.match(result.text, /created a new voucher/);
    assert.match(result.text, /which is unchanged/);
    assert.match(result.text, new RegExp(guidOf(31700)));
    assert.equal(mock.state.imports.length, 1);
});

test('an error while a voucher is read again before its post still lists the vouchers already saved', async () => {
    mock.state.options.objectErrorAt = 3; // 1: lookup of G1, 2: read-back of the created voucher, 3: G1 read again just before its post
    const result = await write([journal({ narration: 'new one' }), journal({ guid: G1 })]);
    assert.equal(result.isError, true);
    assert.match(result.text, /Not enough memory/);
    assert.match(result.text, /The vouchers before it were saved: .*"action":"created"/);
    assert.match(result.text, new RegExp(guidOf(31700)));
    assert.equal(mock.state.imports.length, 1);
});

test('a correction Tally reports but did not make is flagged as unconfirmed', async () => {
    mock.state.options.alterNoop = true;
    const result = await write([journal({ guid: G1 })]);
    assert.equal(result.isError, true);
    assert.equal(result.vouchers[0].confirmed, false);
    assert.match(result.vouchers[0].warning, /was not changed/);
});

test('thirty created vouchers all come back with their guid, read by master id', async () => {
    mock.load([]);
    const vouchers = Array.from({ length: 30 }, (_, i) => journal({ date: '2025-04-30', narration: `n${i}` }));
    const result = await write(vouchers);
    assert.equal(result.isError, undefined, JSON.stringify(result).slice(0, 500));
    assert.equal(result.created, 30);
    assert.equal(result.vouchers.length, 30);
    assert.ok(result.vouchers.every((v) => typeof v.guid === 'string' && v.guid.length > 0));
    assert.equal(mock.state.voucherCollections.length, 0);
});
