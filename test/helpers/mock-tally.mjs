// A stand-in for the Tally Prime XML server, speaking UTF-16LE like the real one.
// The handler receives the decoded request XML and answers through the helpers below
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** configures the environment of the module under test; must run before dist/ is imported */
export function configureEnv(overrides = {}) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-mcp-test-'));
    Object.assign(process.env, {
        TALLY_HOST: '127.0.0.1',
        TALLY_PORT: '1', // nothing listens there: a test that forgets to set the connection fails loudly
        TALLY_STATE_DIR: stateDir,
        TALLY_CONNECT_TIMEOUT_MS: '300',
        ...overrides
    });
    return stateDir;
}

export function startMockTally(handler) {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf16le');
            requests.push(body);
            handler(body, req, res);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                requests,
                close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); })
            });
        });
    });
}

/** answers with a whole UTF-16LE body */
export function reply(res, xml, delayMs = 0) {
    const send = () => {
        if (res.destroyed) return;
        const buf = Buffer.from(xml, 'utf16le');
        res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-16', 'Content-Length': buf.length });
        res.end(buf);
    };
    delayMs > 0 ? setTimeout(send, delayMs) : send();
}

/** reads SVFROMDATE / SVTODATE (d-MMM-yyyy) of a request as ISO dates */
export function requestPeriod(body) {
    const months = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    const iso = (text) => {
        const m = /^(\d{1,2})-(\w{3})-(\d{4})$/.exec(text.trim());
        return `${m[3]}-${String(months[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    };
    return {
        fromDate: iso(/<SVFROMDATE>([^<]+)<\/SVFROMDATE>/.exec(body)[1]),
        toDate: iso(/<SVTODATE>([^<]+)<\/SVTODATE>/.exec(body)[1])
    };
}

/** a ledger-account answer: vouchers, then the synthetic Opening and Closing lines, as Tally emits them.
 *  nature sets the primary group and $IsRevenue carried on the Closing line (isRevenue omitted = tag absent) */
export function ledgerAccountXml(vouchers, opening, closing, fromDate, toDate, nature = {}) {
    const { primaryGroup = 'Indirect Expenses', isRevenue } = nature;
    const d = (iso) => { const [y, m, dd] = iso.split('-'); return `${parseInt(dd)}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m) - 1]}-${y}`; };
    const rows = vouchers.map((v) => `<ROW><GUID>${v.guid}</GUID><DATE>${d(v.date)}</DATE><VOUCHER_TYPE>Journal</VOUCHER_TYPE><VOUCHER_NUMBER>${v.number}</VOUCHER_NUMBER><ALTERNATE_LEDGER>Bank</ALTERNATE_LEDGER><PARTY_LEDGER></PARTY_LEDGER><AMOUNT>${v.amount}</AMOUNT><NARRATION>monthly charge</NARRATION></ROW>`).join('');
    return `<DATA>${rows}<ROW><DATE>${d(fromDate)}</DATE><VOUCHER_TYPE>Opening</VOUCHER_TYPE><AMOUNT>${opening}</AMOUNT></ROW><ROW><DATE>${d(toDate)}</DATE><VOUCHER_TYPE>Closing</VOUCHER_TYPE><AMOUNT>${closing}</AMOUNT><PRIMARY_GROUP>${primaryGroup}</PRIMARY_GROUP><IS_INTEGRATED>Yes</IS_INTEGRATED>${isRevenue === undefined ? '' : `<IS_REVENUE>${isRevenue}</IS_REVENUE>`}</ROW></DATA>`;
}

/** true for the whole-period balance request (ledger-period-balance), which carries no voucher collection */
export function isPeriodBalanceRequest(body) {
    return !body.includes('<TYPE>Voucher</TYPE>');
}

/** the answer to the Company collection query used by probes and server-info */
export function companyXml(names) {
    return `<DATA>${names.map((n, i) => `<ROW><NAME>${n}</NAME><BOOKSFROM>2025-04-01</BOOKSFROM><ISACTIVECOMPANY>${i == 0 ? 1 : 0}</ISACTIVECOMPANY></ROW>`).join('')}</DATA>`;
}
