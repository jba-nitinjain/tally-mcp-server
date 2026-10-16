// voucher-delete against a mock Tally.ERP 9 (test/helpers/mock-books.mjs) which finds a voucher to delete by its date, type and number,
// never by its guid, and renumbers the later vouchers of the type as soon as one is deleted. Every voucher is looked up before anything
// is posted, so a call is refused as a whole when one voucher cannot be confirmed, and read again just before it is sent
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
const G4 = guidOf(31590);
const G5 = guidOf(31585);
const G6 = guidOf(31600);
const G7 = guidOf(31601);
const G8 = guidOf(31602);
const R7 = guidOf(0x7c01);
const UNKNOWN = guidOf(0x7b5a);

const freshBooks = () => mock.load([
    { masterId: 31583, type: 'Journal', number: '243', date: '2025-04-30' },
    { masterId: 31575, type: 'Payment', number: '115', date: '2025-04-15', remoteGuid: R2 },
    { masterId: 31584, type: 'Journal', number: '244', date: '2025-04-30' }
]);
const add = (v) => mock.state.books.set(v.masterId, { guid: guidOf(v.masterId), remoteGuid: '', narration: '', optional: false, alterId: ++mock.state.alterSeq, ...v });

before(async () => { globalThis.tally = await startMockTally(mock.handle); });
after(async () => { await globalThis.tally.close(); });
beforeEach(() => freshBooks());

async function callTool(tool, args) {
    const { stdout } = await run(process.execPath, [path.join(here, 'helpers', 'call-tool.mjs'), tool, JSON.stringify(args)], {
        env: { ...process.env, TALLY_PORT: String(globalThis.tally.port), TALLY_STATE_DIR: stateDir }
    });
    return JSON.parse(stdout);
}
const del = (vouchers) => callTool('voucher-delete', { targetCompany: 'Demo Co', vouchers });

test('a voucher is deleted by its date, type and number, never by its guid, and checked beforehand and afterwards', async () => {
    const result = await del([{ guid: G1 }]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.deleted, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.notAttempted, 0);
    assert.equal(result.unknown, 0);
    assert.equal(result.company, 'Demo Co');
    assert.deepEqual(result.vouchers, [{ status: 'deleted', guid: G1, date: '2025-04-30', voucherType: 'Journal', voucherNumber: '243', confirmed: true }]);
    assert.equal(mock.state.imports.length, 1);
    assert.match(mock.state.imports[0], /<VOUCHER DATE="30-Apr-2025" TAGNAME="Voucher Number" TAGVALUE="243" VCHTYPE="Journal" ACTION="Delete">/);
    assert.doesNotMatch(mock.state.imports[0], /REMOTEID/);
    assert.match(mock.state.imports[0], /<DATE>20250430<\/DATE>/);
    assert.deepEqual(mock.state.objectLookups, ['ID:31583', 'ID:31583', 'ID:31583']);
    assert.equal(mock.state.keyLookups.length, 1);
    assert.equal(mock.state.voucherTypeRequests.length, 0);
    assert.equal(mock.state.voucherCollections.length, 0);
    assert.equal(mock.state.books.has(31583), false);
});

test('Tally renumbering the later vouchers after a deletion does not make the next deletion hit the wrong voucher', async () => {
    add({ masterId: 31585, type: 'Journal', number: '245', date: '2025-04-30' });
    const result = await del([{ guid: G1 }, { guid: G3 }]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.deleted, 2);
    assert.match(mock.state.imports[1], /TAGVALUE="243"/);
    assert.equal(result.vouchers[1].voucherNumber, '243');
    assert.match(result.vouchers[1].note, /renumbered it from 244 to 243/);
    assert.equal(mock.state.books.has(31585), true, 'the voucher after the two deleted ones is untouched');
    assert.equal(mock.state.books.get(31585).number, '243');
    assert.equal(mock.state.books.has(31583), false);
    assert.equal(mock.state.books.has(31584), false);
    assert.equal(result.vouchers[0].note, undefined);
});

test('a voucher which carries a remote id and a number is still deleted by its number', async () => {
    const result = await del([{ guid: G2 }]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.deleted, 1);
    assert.equal(result.vouchers[0].confirmed, true);
    assert.equal(result.vouchers[0].note, undefined);
    assert.match(mock.state.imports[0], /TAGVALUE="115" VCHTYPE="Payment" ACTION="Delete"/);
    assert.doesNotMatch(mock.state.imports[0], /REMOTEID/);
    assert.equal(mock.state.books.has(31575), false);
});

test('a duplicate which stores another voucher\'s guid as its remote id is deleted on its own, and so is the original', async () => {
    add({ masterId: 31600, type: 'Journal', number: '245', date: '2025-04-30', remoteGuid: G1 });
    const first = await del([{ guid: G1 }]);
    assert.equal(first.isError, undefined, JSON.stringify(first));
    assert.equal(mock.state.books.has(31583), false);
    assert.equal(mock.state.books.has(31600), true);

    freshBooks();
    add({ masterId: 31600, type: 'Journal', number: '245', date: '2025-04-30', remoteGuid: G1 });
    const second = await del([{ guid: G6 }]);
    assert.equal(second.isError, undefined, JSON.stringify(second));
    assert.equal(mock.state.books.has(31600), false);
    assert.equal(mock.state.books.has(31583), true);
});

test('a voucher whose number another voucher of its type shares that day is refused, with nothing sent', async () => {
    add({ masterId: 31590, type: 'Journal', number: '243', date: '2025-04-30', optional: true });
    const result = await del([{ guid: G1 }]);
    assert.equal(result.isError, true);
    assert.equal(result.failed, 1);
    assert.equal(result.vouchers[0].status, 'failed');
    assert.match(result.vouchers[0].error, /2 Journal vouchers dated 2025-04-30 carry number 243/);
    assert.match(result.vouchers[0].error, /Tally screen/);
    assert.match(result.vouchers[0].error, new RegExp(G4));
    assert.equal(mock.state.imports.length, 0);
    assert.equal(mock.state.books.has(31583), true);
    assert.equal(mock.state.books.has(31590), true);

    const named = await del([{ date: '2025-04-30', voucherType: 'Journal', voucherNumber: '243' }]);
    assert.equal(named.isError, true);
    assert.match(named.text, /2 vouchers match/);
    assert.equal(mock.state.imports.length, 0);
});

test('a voucher with no number and no id from another program is refused', async () => {
    add({ masterId: 31601, type: 'Journal', number: '', date: '2025-04-30' });
    const result = await del([{ guid: G7 }]);
    assert.equal(result.isError, true);
    assert.equal(result.vouchers[0].status, 'failed');
    assert.match(result.vouchers[0].error, /has no voucher number/);
    assert.equal(mock.state.imports.length, 0);
    assert.equal(mock.state.books.has(31601), true);
});

test('a voucher with no number is deleted through the id another program gave it, when no other voucher carries it', async () => {
    add({ masterId: 31601, type: 'Journal', number: '', date: '2025-04-30', remoteGuid: R7 });
    const result = await del([{ guid: G7 }]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.deleted, 1);
    assert.match(mock.state.imports[0], new RegExp(`<VOUCHER REMOTEID="${R7}" VCHTYPE="Journal" ACTION="Delete">`));
    assert.match(result.vouchers[0].note, /has no voucher number/);
    assert.equal(mock.state.books.has(31601), false);

    freshBooks();
    add({ masterId: 31601, type: 'Journal', number: '', date: '2025-04-30', remoteGuid: R7 });
    add({ masterId: 31602, type: 'Journal', number: '10', date: '2025-05-01', remoteGuid: R7 });
    mock.state.imports = [];
    const shared = await del([{ guid: G7 }]);
    assert.equal(shared.isError, true);
    assert.match(shared.vouchers[0].error, /carried by 2 vouchers/);
    assert.match(shared.vouchers[0].error, new RegExp(G8));
    assert.equal(mock.state.imports.length, 0);
});

test('a voucher of another type with the same number that day is left alone and checked afterwards', async () => {
    add({ masterId: 31603, type: 'Payment', number: '243', date: '2025-04-30' });
    const result = await del([{ guid: G1 }]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.deleted, 1);
    assert.equal(mock.state.books.has(31603), true);
    assert.ok(mock.state.objectLookups.includes('ID:31603'), 'the Payment sharing the number is read again after the deletion');
    assert.match(mock.state.imports[0], /VCHTYPE="Journal"/);
});

test('a guid which is really the stored remote id is found on the voucher date, and refused without one', async () => {
    const withDate = await del([{ guid: R2, date: '2025-04-15' }]);
    assert.equal(withDate.isError, undefined, JSON.stringify(withDate));
    assert.equal(withDate.deleted, 1);
    assert.equal(withDate.vouchers[0].guid, G2);
    assert.match(mock.state.imports[0], /TAGVALUE="115" VCHTYPE="Payment"/);
    assert.equal(mock.state.unknownFilters.length, 0);

    freshBooks();
    const withoutDate = await del([{ guid: R2 }]);
    assert.equal(withoutDate.isError, true);
    assert.match(withoutDate.text, /no voucher with this guid exists in company Demo Co/);
    assert.match(withoutDate.text, /pass the voucher's date as well/);
    assert.equal(mock.state.imports.length, 0);
});

test('a guid which names no voucher refuses the call and deletes nothing', async () => {
    const result = await del([{ guid: UNKNOWN }]);
    assert.equal(result.isError, true);
    assert.match(result.text, /Nothing was deleted from company Demo Co/);
    assert.match(result.text, /never be built or guessed/);
    assert.equal(mock.state.imports.length, 0);
});

test('a date, type or number which differs from what Tally holds for the guid refuses the call', async () => {
    const mismatch = await del([{ guid: G1, date: '2025-04-29', voucherType: 'Payment' }]);
    assert.equal(mismatch.isError, true);
    assert.match(mismatch.text, /Tally holds this voucher as Journal 243 dated 2025-04-30/);
    assert.match(mismatch.text, /date 2025-04-29/);
    assert.equal(mock.state.imports.length, 0);

    const agreeing = await del([{ guid: G1, date: '30/04/2025', voucherType: 'journal', voucherNumber: '243' }]);
    assert.equal(agreeing.isError, undefined, JSON.stringify(agreeing));
    assert.equal(agreeing.deleted, 1);
});

test('a voucher can be named by date, type and number, and a bare date is refused', async () => {
    const named = await del([{ date: '2025-04-30', voucherType: 'Journal', voucherNumber: '243' }]);
    assert.equal(named.isError, undefined, JSON.stringify(named));
    assert.equal(named.deleted, 1);
    assert.equal(named.vouchers[0].guid, G1);

    mock.load([]);
    const bare = await del([{ date: '2025-04-30' }]);
    assert.equal(bare.isError, true);
    assert.match(bare.text, /give its guid/);
    assert.equal(mock.state.keyLookups.length, 0);
    assert.equal(mock.state.imports.length, 0);
});

test('one unconfirmed voucher refuses the whole batch, and a voucher Tally rejects is reported on its own', async () => {
    const refused = await del([{ guid: G1 }, { guid: UNKNOWN }]);
    assert.equal(refused.isError, true);
    assert.equal(mock.state.imports.length, 0);
    assert.match(refused.text, /1 of 2 voucher\(s\) could not be confirmed/);
    assert.match(refused.text, /can be sent again on their own/);
    assert.equal(mock.state.books.has(31583), true);

    mock.state.options.failMasterIds = new Set([31584]);
    const partial = await del([{ guid: G1 }, { guid: G3 }]);
    assert.equal(partial.isError, true);
    assert.equal(partial.deleted, 1);
    assert.equal(partial.failed, 1);
    assert.equal(partial.vouchers[0].status, 'deleted');
    assert.equal(partial.vouchers[1].status, 'failed');
    assert.match(partial.vouchers[1].error, /Voucher could not be deleted/);
    assert.equal(mock.state.imports.length, 2);
    assert.equal(mock.state.books.has(31583), false);
    assert.equal(mock.state.books.has(31584), true);

    freshBooks();
    const twice = await del([{ guid: G1 }, { guid: G1 }]);
    assert.equal(twice.isError, true);
    assert.match(twice.text, /listed more than once/);
    assert.equal(mock.state.imports.length, 0);
});

test('a voucher deleted in Tally between the lookup and the deletion is reported, with nothing sent for it', async () => {
    // the voucher disappears while the first one is being deleted
    mock.state.options.deleteDelayMs = () => { mock.state.books.delete(31584); return 0; };
    const result = await del([{ guid: G1 }, { guid: G3 }]);
    assert.equal(result.isError, true);
    assert.equal(result.vouchers[0].status, 'deleted');
    assert.equal(result.vouchers[1].status, 'failed');
    assert.match(result.vouchers[1].error, /no longer in the books/);
    assert.equal(mock.state.imports.length, 1);
});
