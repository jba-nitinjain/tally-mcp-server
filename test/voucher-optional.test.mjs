// voucher-create-update with isOptional, and optional-vouchers, against the mock books (test/helpers/mock-books.mjs). Seen live on
// TallyPrime (29/10/2026): ISOPTIONAL in an Alter found by date, type and number turns a voucher optional or regular in place, keeping its
// guid; a voucher made optional takes the next number of its type, one made regular keeps its number
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
const G2 = guidOf(31590);

const freshBooks = () => mock.load([
    { masterId: 31583, type: 'Journal', number: '243', date: '2025-04-30' },
    { masterId: 31590, type: 'Journal', number: '250', date: '2025-05-02', optional: true, narration: 'provision', entries: [{ ledgerName: 'Office Expenses', amount: -500 }, { ledgerName: 'Cash', amount: 500 }] }
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

test('an existing voucher is made optional in place, and the number Tally gives it is returned', async () => {
    const size = mock.state.books.size;
    const result = await write([journal({ guid: G1, isOptional: true })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.altered, 1);
    assert.match(mock.state.imports[0], /TAGVALUE="243" VCHTYPE="Journal" ACTION="Alter"/);
    assert.match(mock.state.imports[0], /<ISOPTIONAL>Yes<\/ISOPTIONAL>/);
    const voucher = mock.state.books.get(31583);
    assert.equal(voucher.optional, true);
    assert.equal(mock.state.books.size, size, 'no duplicate voucher');
    assert.equal(result.vouchers[0].isOptional, true);
    assert.equal(result.vouchers[0].voucherNumber, voucher.number);
    assert.notEqual(voucher.number, '243');
    assert.equal(result.vouchers[0].note, `Tally numbered it ${voucher.number}`);
});

test('an optional voucher is made regular again and keeps its number', async () => {
    const result = await write([journal({ guid: G2, date: '2025-05-02', isOptional: false })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.match(mock.state.imports[0], /<ISOPTIONAL>No<\/ISOPTIONAL>/);
    assert.equal(mock.state.books.get(31590).optional, false);
    assert.equal(mock.state.books.get(31590).number, '250');
    assert.equal(result.vouchers[0].isOptional, false);
    assert.equal(result.vouchers[0].voucherNumber, '250');
});

test('changing an optional voucher without isOptional keeps it optional', async () => {
    const result = await write([journal({ guid: G2, date: '2025-05-02', narration: 'revised' })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.match(mock.state.imports[0], /<ISOPTIONAL>Yes<\/ISOPTIONAL>/);
    assert.equal(mock.state.books.get(31590).optional, true);
    assert.equal(mock.state.books.get(31590).narration, 'revised');
    assert.equal(result.vouchers[0].isOptional, true);
});

test('changing a regular voucher without isOptional keeps it regular and says nothing about it', async () => {
    const result = await write([journal({ guid: G1, narration: 'x' })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.match(mock.state.imports[0], /<ISOPTIONAL>No<\/ISOPTIONAL>/);
    assert.equal(mock.state.books.get(31583).optional, false);
    assert.equal('isOptional' in result.vouchers[0], false);
});

test('a new voucher is created optional', async () => {
    const result = await write([journal({ isOptional: true })]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.created, 1);
    assert.match(mock.state.imports[0], /ACTION="Create"/);
    assert.match(mock.state.imports[0], /<ISOPTIONAL>Yes<\/ISOPTIONAL>/);
    assert.equal(result.vouchers[0].isOptional, true);
    const created = [...mock.state.books.values()].find((v) => v.guid === result.vouchers[0].guid);
    assert.equal(created.optional, true);
});

test('a new voucher without isOptional sends no ISOPTIONAL, leaving it to the voucher type', async () => {
    const result = await write([journal({})]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.doesNotMatch(mock.state.imports[0], /ISOPTIONAL/);
    assert.equal('isOptional' in result.vouchers[0], false);
});

test('optional-vouchers lists the optional vouchers of the period with their entries', async () => {
    const result = await callTool('optional-vouchers', { targetCompany: 'Demo Co', fromDate: '2025-04-01', toDate: '2026-03-31' });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.company, 'Demo Co');
    assert.equal(result.count, 1);
    assert.deepEqual(result.vouchers, [{
        guid: G2, date: '2025-05-02', voucherType: 'Journal', voucherNumber: '250', narration: 'provision', partyLedgerName: '',
        ledgerEntries: [{ ledgerName: 'Office Expenses', amount: -500 }, { ledgerName: 'Cash', amount: 500 }]
    }]);
    assert.equal(mock.state.unknownFilters.length, 0);
});

test('optional-vouchers finds a voucher just made optional, and not one made regular', async () => {
    await write([journal({ guid: G1, isOptional: true })]);
    await write([journal({ guid: G2, date: '2025-05-02', isOptional: false })]);
    const result = await callTool('optional-vouchers', { targetCompany: 'Demo Co', fromDate: '2025-04-01', toDate: '2026-03-31' });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.deepEqual(result.vouchers.map((v) => v.guid), [G1]);
    assert.deepEqual(result.vouchers[0].ledgerEntries, [{ ledgerName: 'Cash', amount: 290 }, { ledgerName: 'Office Expenses', amount: -290 }]);
});

test('optional-vouchers refuses a period which ends before it starts', async () => {
    const result = await callTool('optional-vouchers', { targetCompany: 'Demo Co', fromDate: '2025-05-01', toDate: '2025-04-01' });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /after toDate/);
});
