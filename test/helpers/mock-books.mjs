// A stand-in for the vouchers of a Tally.ERP 9 company, shared by the voucher tests. It models what was observed live
// (see docs/CHANGELOG.md v7.9.6): an import finds a voucher by DATE + VCHTYPE + TAGNAME="Voucher Number" TAGVALUE, or by
// REMOTEID against the stored REMOTEGUID only (never against the guid); a deletion renumbers the later vouchers of the
// type and date; an Alter that finds nothing creates a new voucher; the key lookup Data report returns no rows for
// $$IsEqual filters. Usage: const books = createMockBooks(); const tally = await startMockTally(books.handle);
import { reply, companyXml, requestPeriod } from './mock-tally.mjs';

export const GUID_PREFIX = 'aaaa0000-0000-0000-0000-000000000000-';
export const guidOf = (id) => GUID_PREFIX + id.toString(16).padStart(8, '0');

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const dmyToIso = (text) => {
    const m = /^(\d{1,2})-(\w{3})-(\d{4})$/.exec((text || '').trim());
    return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}` : '';
};
const unescapeXml = (text) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const ok = (created, altered, deleted, lastVchId) => `<RESPONSE><CREATED>${created}</CREATED><ALTERED>${altered}</ALTERED><DELETED>${deleted}</DELETED><LASTVCHID>${lastVchId}</LASTVCHID><LASTMID>0</LASTMID><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>`;
const lineError = (text) => `<RESPONSE><LINEERROR>${text}</LINEERROR><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><LASTVCHID>0</LASTVCHID><LASTMID>0</LASTMID><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>1</ERRORS><CANCELLED>0</CANCELLED><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>`;
// the Object export of a voucher, in the live shape: the whole voucher, with nested DATE tags inside its lists
const objectXml = (v) => `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DESC></DESC><DATA><TALLYMESSAGE><VOUCHER ID="${v.masterId}" REQNAME="ID:${v.masterId}" VCHTYPE="${v.type}" OBJVIEW="Accounting Voucher View"><BANKERSDATE.LIST TYPE="Date"><BANKERSDATE/></BANKERSDATE.LIST><DATE>${v.date.replace(/-/g, '')}</DATE><GUID>${v.guid}</GUID>${v.remoteGuid ? `<REMOTEGUID>${v.remoteGuid}</REMOTEGUID>` : '<REMOTEGUID/>'}<VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME><VOUCHERNUMBER>${v.number}</VOUCHERNUMBER><MASTERID> ${v.masterId}</MASTERID><ALTERID> ${v.alterId}</ALTERID><NARRATION>${v.narration}</NARRATION><ISOPTIONAL>${v.optional ? 'Yes' : 'No'}</ISOPTIONAL>${(v.entries || []).map((e) => `<ALLLEDGERENTRIES.LIST><NARRATION/><LEDGERNAME>${e.ledgerName}</LEDGERNAME><AMOUNT>${e.amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('') || '<ALLLEDGERENTRIES.LIST><BANKALLOCATIONS.LIST><DATE>20250501</DATE></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>'}</VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
// TallyPrime answers an unknown id with a bare ERRORMSG, outside any ENVELOPE (seen live)
const notFound = (id) => `<ERRORMSG>Could not find Voucher:${id}!</ERRORMSG>\r\n`;
const keyRow = (v) => `<ROW><GUID>${v.guid}</GUID><REMOTEGUID>${v.remoteGuid}</REMOTEGUID><MASTERID>${v.masterId}</MASTERID><DATE>${v.date}</DATE><VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME><VOUCHERNUMBER>${v.number}</VOUCHERNUMBER><ALTERID>${v.alterId}</ALTERID></ROW>`;

export function createMockBooks({ companies = ['Demo Co'], ledgers = ['Cash', 'Office Expenses'], voucherTypes = ['Journal', 'Payment'] } = {}) {
    const state = { books: new Map(), nextMasterId: 31700, alterSeq: 5000, imports: [], objectLookups: [], keyLookups: [], voucherCollections: [], voucherTypeRequests: [], unknownFilters: [], options: {} };
    const resetOptions = () => {
        state.options = { failMasterIds: new Set(), deleteDelayMs: 0, objectDelayMs: 0, keyDelayMs: 0, createDelayMs: 0, alterCreates: false, alterNoop: false };
    };
    resetOptions();
    const delayOf = (option, n) => (typeof option === 'function' ? option(n) : option) || 0;

    /** replaces the books with the vouchers listed, and clears every log and option */
    function load(list) {
        state.books = new Map();
        for (const v of list)
            state.books.set(v.masterId, { guid: guidOf(v.masterId), remoteGuid: '', narration: '', optional: false, ...v, alterId: ++state.alterSeq });
        state.nextMasterId = 31700;
        state.imports = [];
        state.objectLookups = [];
        state.keyLookups = [];
        state.voucherCollections = [];
        state.voucherTypeRequests = [];
        state.unknownFilters = [];
        resetOptions();
    }

    // the ISOPTIONAL of an import body: true, false, or undefined when it is not sent
    const optionalOf = (body) => {
        const flag = /<ISOPTIONAL>([^<]*)/.exec(body)?.[1];
        return flag === undefined ? undefined : flag.trim().toLowerCase() === 'yes';
    };
    const entriesOf = (body) => [...body.matchAll(/<ALLLEDGERENTRIES\.LIST>\s*<LEDGERNAME>([^<]*)<\/LEDGERNAME>[\s\S]*?<AMOUNT>([^<]*)<\/AMOUNT>/g)].map((m) => ({ ledgerName: unescapeXml(m[1]), amount: parseFloat(m[2]) }));

    const nextNumber = (type) => String(Math.max(0, ...[...state.books.values()].filter((v) => v.type === type && /^\d+$/.test(v.number)).map((v) => parseInt(v.number))) + 1);

    function createVoucher(attrs, body, remoteGuid) {
        const masterId = state.nextMasterId++;
        const type = attrs.VCHTYPE;
        const bodyNumber = /<VOUCHERNUMBER>([^<]*)/.exec(body)?.[1];
        const date = /<DATE>(\d{8})<\/DATE>/.exec(body)?.[1] || '20250101';
        state.books.set(masterId, {
            masterId, guid: guidOf(masterId), remoteGuid, type, number: bodyNumber ? unescapeXml(bodyNumber) : nextNumber(type),
            date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, alterId: ++state.alterSeq, narration: unescapeXml(/<NARRATION>([^<]*)/.exec(body)?.[1] || ''),
            optional: optionalOf(body) ?? false, entries: entriesOf(body)
        });
        return masterId;
    }

    // the voucher an import is aimed at, as Tally resolves it
    function matchVoucher(attrs) {
        const lstAll = [...state.books.values()].sort((a, b) => a.masterId - b.masterId);
        if (attrs.TAGNAME !== undefined) {
            if (attrs.TAGNAME.toLowerCase() !== 'voucher number') return undefined;
            return lstAll.find((v) => v.date === dmyToIso(attrs.DATE) && v.type === attrs.VCHTYPE && v.number.toLowerCase() === (attrs.TAGVALUE || '').toLowerCase());
        }
        if (attrs.REMOTEID !== undefined)
            return lstAll.find((v) => v.remoteGuid !== '' && v.remoteGuid.toLowerCase() === attrs.REMOTEID.toLowerCase()); // never the guid
        return undefined;
    }

    function handleImport(body, res) {
        state.imports.push(body);
        const tag = /<VOUCHER ([^>]*)>/.exec(body);
        const attrs = {};
        for (const m of (tag?.[1] || '').matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = unescapeXml(m[2]);
        const rest = body.slice((tag?.index || 0) + (tag?.[0].length || 0));
        const action = attrs.ACTION;

        if (action === 'Delete') {
            const delay = delayOf(state.options.deleteDelayMs, state.imports.length);
            const voucher = matchVoucher(attrs);
            if (!voucher) return reply(res, lineError('Voucher does not exist!'), delay);
            if (state.options.failMasterIds.has(voucher.masterId)) return reply(res, lineError('Voucher could not be deleted'), delay);
            state.books.delete(voucher.masterId);
            // Tally renumbers the later vouchers of the type on the date as soon as one is deleted
            for (const v of state.books.values()) {
                if (v.type === voucher.type && v.date === voucher.date && /^\d+$/.test(v.number) && /^\d+$/.test(voucher.number) && parseInt(v.number) > parseInt(voucher.number)) {
                    v.number = String(parseInt(v.number) - 1);
                    v.alterId = ++state.alterSeq;
                }
            }
            return reply(res, ok(0, 0, 1, 0), delay);
        }

        if (action === 'Alter') {
            const voucher = matchVoucher(attrs);
            if (!voucher || state.options.alterCreates) {
                const id = createVoucher(attrs, rest, attrs.REMOTEID || '');
                return reply(res, ok(1, 0, 0, id), delayOf(state.options.createDelayMs, state.imports.length));
            }
            if (state.options.alterNoop) return reply(res, ok(0, 1, 0, 0));
            const date = /<DATE>(\d{8})<\/DATE>/.exec(rest)?.[1];
            if (date) voucher.date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
            voucher.number = unescapeXml(/<VOUCHERNUMBER>([^<]*)/.exec(rest)?.[1] || ''); // an Alter without a number blanks it
            voucher.narration = unescapeXml(/<NARRATION>([^<]*)/.exec(rest)?.[1] || '');
            voucher.entries = entriesOf(rest);
            // seen live on TallyPrime: a voucher made optional takes the next number of its type; one made regular keeps its number
            const optional = optionalOf(rest);
            if (optional === true && !voucher.optional)
                voucher.number = nextNumber(voucher.type);
            if (optional !== undefined)
                voucher.optional = optional;
            voucher.alterId = ++state.alterSeq;
            return reply(res, ok(0, 1, 0, 0));
        }

        const id = createVoucher(attrs, rest, '');
        return reply(res, ok(1, 0, 0, id), delayOf(state.options.createDelayMs, state.imports.length));
    }

    function handleKeyLookup(body, res) {
        state.keyLookups.push(body);
        const filter = unescapeXml(/NAME="TallyMcpVoucherKeyFilter">([^<]*)</.exec(body)[1]);
        const { fromDate, toDate } = requestPeriod(body);
        const lstInPeriod = [...state.books.values()].filter((v) => v.date >= fromDate && v.date <= toDate);
        const lower = (text) => (text || '').toLowerCase();
        let lstRow = [];
        let m;
        if (filter.includes('$$IsEqual')) lstRow = []; // Tally.ERP 9 evaluates these to nothing
        else if ((m = /^\$VoucherNumber = "(.*)"$/.exec(filter))) lstRow = lstInPeriod.filter((v) => lower(v.number) === lower(m[1]));
        else if (filter === '$IsOptional') lstRow = lstInPeriod.filter((v) => v.optional);
        else if ((m = /^\$RemoteGUID = "(.*)"$/.exec(filter))) lstRow = lstInPeriod.filter((v) => v.remoteGuid !== '' && lower(v.remoteGuid) === lower(m[1]));
        else if ((m = /^\$Guid = "(.*)" OR \$RemoteGUID = "(.*)"$/.exec(filter))) lstRow = lstInPeriod.filter((v) => lower(v.guid) === lower(m[1]) || (v.remoteGuid !== '' && lower(v.remoteGuid) === lower(m[2])));
        else state.unknownFilters.push(filter);
        return reply(res, `<DATA>${lstRow.map(keyRow).join('')}</DATA>`, delayOf(state.options.keyDelayMs, state.keyLookups.length));
    }

    function handle(body, req, res) {
        if (body.includes('<TALLYREQUEST>Import Data</TALLYREQUEST>')) return handleImport(body, res);
        if (body.includes('<TYPE>Object</TYPE>')) {
            const id = /<ID TYPE="Name">([^<]*)<\/ID>/.exec(body)[1];
            state.objectLookups.push(id);
            if (state.options.objectErrorAt === state.objectLookups.length) return reply(res, '<ENVELOPE><BODY><DATA><ERRORMSG>Not enough memory</ERRORMSG></DATA></BODY></ENVELOPE>');
            const voucher = state.books.get(parseInt(id.replace('ID:', '')));
            return reply(res, voucher ? objectXml(voucher) : notFound(id), delayOf(state.options.objectDelayMs, state.objectLookups.length));
        }
        if (body.includes('TallyMcpVoucherKey')) return handleKeyLookup(body, res);
        if (body.includes('<TYPE>Company</TYPE>')) return reply(res, companyXml(companies));
        if (body.includes('<TYPE>Ledger</TYPE>')) return reply(res, `<DATA>${ledgers.map((n) => `<ROW><NAME>${n}</NAME></ROW>`).join('')}</DATA>`);
        if (body.includes('<TYPE>VoucherType</TYPE>')) {
            state.voucherTypeRequests.push(body);
            return reply(res, `<DATA>${voucherTypes.map((n) => `<ROW><NAME>${n}</NAME></ROW>`).join('')}</DATA>`);
        }
        if (body.includes('<TYPE>StockItem</TYPE>')) return reply(res, '<DATA></DATA>');
        if (body.includes('<TYPE>Voucher</TYPE>')) state.voucherCollections.push(body); // the generic voucher collection, which the voucher tools must no longer use
        return reply(res, '<DATA></DATA>');
    }

    return { state, load, handle };
}
