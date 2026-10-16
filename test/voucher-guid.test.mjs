// Regression test for "The connector can't change an existing voucher": the create answer carried no guid, so the model built one by
// counting on from other guids, and Tally answered the made-up guid with a bare "Voucher does not exist!". A created voucher now comes
// back with its guid (read by master id), a guid naming no voucher is refused before anything is posted, and a correction which moves a
// voucher to a new date is aimed at its current date and number without searching any period
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

const KNOWN_GUID = guidOf(31583);
const NEW_GUID = guidOf(31700);
const UNKNOWN_A = guidOf(0x7b5a);
const UNKNOWN_B = guidOf(0x7b5b);

before(async () => { globalThis.tally = await startMockTally(mock.handle); });
after(async () => { await globalThis.tally.close(); });
beforeEach(() => mock.load([{ masterId: 31583, type: 'Journal', number: '243', date: '2025-04-30' }]));

async function callTool(tool, args) {
    const { stdout } = await run(process.execPath, [path.join(here, 'helpers', 'call-tool.mjs'), tool, JSON.stringify(args)], {
        env: { ...process.env, TALLY_PORT: String(globalThis.tally.port), TALLY_STATE_DIR: stateDir }
    });
    return JSON.parse(stdout);
}

const journal = (extra) => ({ date: '2025-04-30', voucherType: 'Journal', ledgerEntries: [{ ledgerName: 'Cash', amount: 290 }, { ledgerName: 'Office Expenses', amount: -290 }], ...extra });

test('a created voucher comes back with the guid and number Tally gave it', async () => {
    const result = await callTool('voucher-create-update', { targetCompany: 'Demo Co', vouchers: [journal()] });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.created, 1);
    assert.deepEqual(result.vouchers, [{ action: 'created', guid: NEW_GUID, date: '2025-04-30', voucherType: 'Journal', voucherNumber: '244' }]);
    assert.equal(mock.state.imports.length, 1);
    assert.ok(mock.state.objectLookups.includes('ID:31700'), 'the new voucher is read back by its master id');
    assert.equal(mock.state.voucherCollections.length, 0);
});

test('an alteration of a guid that names no voucher is refused before anything is posted, since Tally would create it', async () => {
    const result = await callTool('voucher-create-update', { targetCompany: 'Demo Co', vouchers: [journal({ guid: UNKNOWN_A })] });
    assert.equal(result.isError, true);
    assert.match(result.text, new RegExp(`No voucher with guid ${UNKNOWN_A} exists in company Demo Co, so nothing was sent to Tally`));
    assert.match(result.text, /never be built or guessed/);
    assert.equal(mock.state.imports.length, 0);
});

test('a correction which moves a voucher to a new date is targeted by its current date and number', async () => {
    const result = await callTool('voucher-create-update', { targetCompany: 'Demo Co', vouchers: [journal({ guid: KNOWN_GUID, date: '2025-05-16' })] });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.altered, 1);
    assert.deepEqual(result.vouchers, [{ action: 'altered', guid: KNOWN_GUID, date: '2025-05-16', voucherType: 'Journal', voucherNumber: '243', confirmed: true }]);
    assert.equal(mock.state.imports.length, 1);
    assert.match(mock.state.imports[0], /DATE="30-Apr-2025" TAGNAME="Voucher Number" TAGVALUE="243"[^>]*ACTION="Alter"/);
    assert.match(mock.state.imports[0], /<DATE>20250516<\/DATE>/);
    assert.equal(mock.state.voucherCollections.length, 0);
    assert.deepEqual(mock.state.objectLookups, ['ID:31583', 'ID:31583', 'ID:31583']);
    assert.equal(mock.state.keyLookups.length, 1, 'one search of the voucher\'s own day, to be sure the number is unique');
});

test('a deletion of a guid that names no voucher is refused, with nothing deleted, and explains that the guid is wrong', async () => {
    const result = await callTool('voucher-delete', { targetCompany: 'Demo Co', vouchers: [{ guid: UNKNOWN_B, date: '2025-04-30', voucherType: 'Journal' }] });
    assert.equal(result.isError, true);
    assert.match(result.text, /Nothing was deleted from company Demo Co/);
    assert.match(result.text, /no voucher with this guid exists in company Demo Co/);
    assert.match(result.text, /never be built or guessed/);
    assert.equal(mock.state.imports.length, 0);
});
