import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { deleteMasters, deleteVouchers, fetchReport, getTallyConnection, importMasters, importVouchers, invokeTallyAction, probeTallyInstance, queryCollection, renameObjectArrayProperties, resetTallyConnection, scanTallyInstances, setTallyConnection } from './tally.mjs';
import { cacheTable, executeSQL } from './database.mjs';
import { lstCollectionFields, lstOptionCountryState } from './definition.mjs';
import { utility } from './utility.mjs';
dotenv.config({ override: true, quiet: true });
const isWriteBlocked = /^(1|true|yes)$/i.test((process.env.BLOCK_WRITE || '').trim());
const lstCollections = lstCollectionFields.map((item) => item.collection);
const lstCostingMethod = ['Avg. Cost', 'FIFO', 'FIFO Perpetual', 'Last Purchase Cost', 'LIFO Annual', 'LIFO Perpetual', 'Monthly Avg. Cost', 'Std. Cost', 'At Zero Cost'];
const lstBillType = ['New Ref', 'Agst Ref', 'Advance', 'On Account'];
const lstVoucherView = ['Accounting Voucher View', 'Invoice Voucher View', 'Inventory Voucher View', 'Consumption Voucher View'];
const lstNumberingMethod = ['Automatic', 'Automatic (Manual Override)', 'Manual', 'Multi-User Auto'];
const lstPayHeadType = ['Earnings for Employees', 'Deductions from Employees', 'Employees Statutory Deductions', 'Employers Statutory Contributions', 'Employers Other Charges', 'Bonus', 'Gratuity', 'Loans and Advances', 'Reimbursements to Employees', 'Not Applicable'];
const lstCalculationType = ['On Attendance', 'As Computed Value', 'Flat Rate', 'On Production', 'As User Defined Value'];
const lstRoundingMethod = ['Not Applicable', 'Normal Rounding', 'Downward Rounding', 'Upward Rounding'];
const lstAttendanceNature = ['Attendance/Leave with Pay', 'Leave without Pay', 'User Defined'];
/**
 * Shape of a single inventory line, shared by the regular inventory entries of an invoice
 * and by the source / destination entries of a stock journal
 */
const inventoryEntrySchema = z.object({
    stockItemName: z.string().describe('stock item name, validate it using list-master tool with collection as stockitem'),
    quantity: z.number().describe('quantity of the stock item as an absolute positive number, inward or outward movement is derived by Tally from the voucher type and from the list the entry belongs to'),
    rate: z.number().optional().describe('optional rate per unit of the stock item'),
    unit: z.string().optional().describe('optional unit of measurement of the quantity and rate, defaults to the base unit of the stock item'),
    amount: z.number().describe('value of this inventory entry, debit is negative (stock coming in, like purchase or production) and credit is positive (stock going out, like sales or consumption)'),
    godownName: z.string().optional().describe('optional godown name from which stock moves out or into which stock moves in, validate it using list-master tool with collection as godown'),
    batchName: z.string().optional().describe('optional batch name, applicable for a stock item maintained batch wise'),
    accountingLedger: z.string().optional().describe('sales, purchase or stock adjustment ledger to which the value of this inventory entry is posted, mandatory for an invoice like Sales or Purchase, validate it using list-master tool with collection as ledger')
});
/**
 * Collections which represent a master and can therefore be listed by name.
 * Derived from the collection definitions so that the two can never drift apart,
 * which used to leave list-master offering collections it could not resolve
 */
const lstMasterCollection = lstCollections.filter((collection) => collection !== 'Bill').map((collection) => collection.toLowerCase());
/**
 * Decides per master whether Tally is being asked to create or to alter, by matching each one
 * against what Tally already holds. ACTION="Create" is not a safe no-op for a master which
 * already exists: for some master types (units being the one that bites) Tally inserts a second
 * record instead of altering the first, leaving the company with a duplicated name which it then
 * reports as an internal error. Duplicates inside a single request are rejected for the same reason
 */
async function resolveMasterActions(collection, lstMaster, targetCompany) {
    const lstIdentity = lstMaster.map((master) => utility.String.normaliseName((master._name || master.name || ''))); //names accepted raw or escaped
    const lstDuplicate = lstIdentity.filter((name, index) => name !== '' && lstIdentity.indexOf(name) !== index);
    if (lstDuplicate.length > 0)
        throw new Error(`The same master appears more than once in this request: ${Array.from(new Set(lstDuplicate)).join(', ')}. Send one entry per master, since Tally can end up with duplicated records otherwise`);
    const lstExisting = await queryCollection(collection, ['Name'], new Map(), targetCompany);
    const lstExistingName = new Map();
    lstExisting.forEach((item) => lstExistingName.set(utility.String.nameKey(item.Name), item.Name));
    return lstMaster.map((master, index) => {
        const exactName = lstExistingName.get(utility.String.nameKey(lstIdentity[index]));
        if (master._name && !exactName)
            throw new Error(`No ${collection} master named ${master._name} exists in Tally, so it cannot be modified. Kindly validate it using list-master tool`);
        return { ...master, _name: exactName || master._name, action: exactName ? 'Alter' : 'Create' };
    });
}
/**
 * Schema of the targetCompany argument shared by every tool which reads or writes company data.
 * The company is mandatory on every call: with more than one company open in Tally, a request
 * which leaves it out is served from whichever company the Tally screen happens to have in focus,
 * which silently produced another company's trial balance in an audit engagement. The custom
 * error names the argument when the MCP client leaves it out altogether; an empty or unknown
 * name is refused by resolveTargetCompany with the list of companies open
 */
const targetCompanySchema = z.string({ error: 'targetCompany is required on every call. Call server-info to see which companies are open in Tally and pass one of them exactly as listed' })
    .describe('company name, MANDATORY on every call: pass it exactly as listed by server-info (or list-master with collection as company). a call without it, or naming a company which is not open in Tally, is refused with the list of companies open. the response echoes the company the data was served from in a company property, assert it matches the company intended');
/**
 * Formats the companies open in Tally for an error message, so that the caller can pick one
 * and retry without a further round trip
 */
function formatCompanyList(lstName) {
    return lstName.length > 0 ? lstName.map((name) => `"${name}"`).join(', ') : 'none (open a company in Tally first)';
}
/**
 * Resolves the company a data or write tool must run against, from the same company list that
 * server-info reports. targetCompany is mandatory: a blank value, or a name which is not among the
 * companies currently open, is refused with the list of open companies, so a request can never
 * fall through to whichever company the Tally screen has in focus. The name returned is the exact
 * one Tally holds (surrounding whitespace trimmed, case-insensitive fallback), which is what goes
 * into SVCURRENTCOMPANY of the request and is echoed back in the company property of the response
 */
async function resolveTargetCompany(targetCompany) {
    const requestedName = typeof targetCompany === 'string' ? utility.String.normaliseName(targetCompany) : ''; //accepted raw or XML-escaped (feedback #34)
    const lstCompany = await queryCollection('Company', ['Name'], new Map());
    const lstOpenName = lstCompany.map((item) => item.Name).filter((name) => typeof name === 'string' && name.trim() !== '');
    if (requestedName === '')
        throw new Error(`targetCompany is required on every call and was not supplied. Companies currently open in Tally: ${formatCompanyList(lstOpenName)}. Pass one of these names exactly as listed`);
    const exactName = lstOpenName.find((name) => name === requestedName)
        || lstOpenName.find((name) => name.trim().toLowerCase() === requestedName.toLowerCase());
    if (!exactName)
        throw new Error(`targetCompany "${requestedName}" is not among the companies currently open in Tally: ${formatCompanyList(lstOpenName)}. Pass one of these names exactly as listed, or open the company in Tally first`);
    return exactName;
}
/**
 * Caches a report into pglite with a company column stamped on every row, so that a figure taken
 * from a cached table later in the session can still be traced to the company it came from
 */
async function cacheCompanyTable(lstColumnMetadata, lstRow, company) {
    const lstColumn = new Map(lstColumnMetadata);
    lstColumn.set('company', 'string');
    return cacheTable(lstColumn, (Array.isArray(lstRow) ? lstRow : []).map((row) => ({ ...row, company })));
}
/**
 * Builds the response of a report tool. An empty result used to be reported as a well formed
 * success carrying a blank tableID, which a caller could not tell apart from Tally having no
 * company loaded at all, so the empty case now says so explicitly. The company the data was
 * served from is echoed on every response, so a caller can assert it before using a figure
 */
function buildTableResult(tableID, lstRow, company) {
    if (!Array.isArray(lstRow) || lstRow.length === 0) {
        return JSON.stringify({
            tableID: '',
            rowCount: 0,
            company,
            message: 'Tally returned no rows, so no table was cached. Apart from the data genuinely not existing, this is also what happens when the requested period falls outside the books of this company. Call the server-info tool to check whether Tally is reachable and which companies are open'
        });
    }
    return JSON.stringify({ tableID, rowCount: lstRow.length, company });
}
/**
 * Orders the rows of a ledger-account report as Opening, vouchers, Closing and checks that the
 * vouchers actually explain the movement between the two balances.
 *
 * Tally emits the two synthetic lines after the vouchers (Opening, then Closing). The Closing line also
 * carries the ledger's primary group and the company's "Integrate Accounts and Inventory" flag, which are
 * read here and never cached as columns. A statement whose vouchers do not add up to the closing balance
 * is reported as reconciled: false with a note, because an LLM caller would otherwise read an empty or
 * partial statement as proof that the ledger had no activity
 */
function assembleLedgerAccount(lstRow) {
    const isSynthetic = (r, voucherType) => r && !r.guid && r.voucher_type === voucherType;
    const round2 = (n) => Math.round(n * 100) / 100;
    const toNumber = (v) => (typeof v === 'number' && !isNaN(v)) ? v : 0;
    const rows = lstRow.slice();
    const idxClosing = rows.findIndex(r => isSynthetic(r, 'Closing'));
    const closingRow = idxClosing >= 0 ? rows.splice(idxClosing, 1)[0] : undefined;
    const idxOpening = rows.findIndex(r => isSynthetic(r, 'Opening'));
    const openingRow = idxOpening >= 0 ? rows.splice(idxOpening, 1)[0] : undefined;
    // the report output names the field party_ledger while the cached column is party_name; copy it across so the column is populated
    const vouchers = rows.map(r => ({ ...r, party_name: r.party_name || r.party_ledger || '' }));
    const opening = toNumber(openingRow?.amount);
    const closing = toNumber(closingRow?.amount);
    const movement = round2(vouchers.reduce((sum, r) => sum + toNumber(r.amount), 0));
    const unexplained = round2(closing - opening - movement);
    const balancesPresent = !!openingRow && !!closingRow;
    const reconciled = balancesPresent && Math.abs(unexplained) <= 0.01;
    const primaryGroup = String(closingRow?.primary_group || '').trim();
    const isStockInHand = /^stock[\s-]*in[\s-]*hand$/i.test(primaryGroup);
    const integratedRaw = String(closingRow?.is_integrated || '').trim().toLowerCase();
    const isIntegrated = integratedRaw === 'yes' ? true : (integratedRaw === 'no' ? false : undefined);
    const summary = {
        reconciled,
        unexplainedMovement: unexplained,
        openingBalance: opening,
        closingBalance: closing,
        voucherCount: vouchers.length
    };
    if (!balancesPresent) {
        summary.note = 'Tally did not return the Opening and Closing balance rows for this ledger, so the statement cannot be verified as complete. Treat it as "could not retrieve", not as "no transactions", and cross-check the ledger with trial-balance';
    }
    else if (isStockInHand) {
        const source = isIntegrated === false
            ? 'Integrate Accounts and Inventory is set to No for this company, so the balance is the closing stock value keyed into the ledger master'
            : (isIntegrated === true
                ? 'Integrate Accounts and Inventory is set to Yes for this company, so the balance is taken from the stock items (inventory masters)'
                : 'the balance is derived from stock values (inventory masters or closing stock entered in the ledger master)');
        summary.note = `This ledger sits under the primary group Stock-in-Hand. Tally values it from stock, not from vouchers: ${source}. `
            + (reconciled
                ? 'Opening and closing agree for this period, so there is no movement to explain'
                : `The movement of ${unexplained} between opening ${opening} and closing ${closing} has no underlying vouchers and no narration to look for; it is not evidence of missing entries`)
            + '. Use the stock-summary tool for the item-wise picture behind this balance';
    }
    else if (!reconciled) {
        summary.note = `Opening ${opening} plus the ${vouchers.length} voucher amount(s) returned (${movement}) comes to ${round2(opening + movement)}, but Tally reports a closing balance of ${closing} for this ledger and period. ${unexplained} of movement is not explained by the rows returned, so this statement is incomplete and must not be read as "no activity". Likely causes: vouchers in which this ledger appears on more than one line (only the first line is picked up), or vouchers of a type the report excludes. Cross-check with trial-balance before relying on it`;
    }
    const ordered = [];
    if (openingRow)
        ordered.push(openingRow);
    ordered.push(...vouchers);
    if (closingRow)
        ordered.push(closingRow);
    return { rows: ordered, summary };
}
/**
 * Version reported to the MCP client, read from package.json of the deployment so that
 * the build actually running can be identified from the client
 */
function resolveServerVersion() {
    try {
        const pathPackageJson = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
        const version = JSON.parse(readFileSync(pathPackageJson, 'utf8')).version;
        return typeof version === 'string' ? version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Converts a thrown value into a readable message, since JSON.stringify() on an
 * Error instance yields an empty object hiding the reason of failure from the LLM
 */
function formatError(err) {
    if (typeof err === 'string')
        return err;
    else if (err instanceof Error)
        return err.message;
    else
        return JSON.stringify(err);
}
/**
 * Builds a TDL string literal for a name: double quotes are doubled, as TDL expects
 */
function tdlString(value) {
    return value.replace(/"/g, '""');
}
/**
 * Resolves a single master name supplied by a caller (ledgerName, itemName ...) to the name Tally holds.
 * The input is accepted raw or XML-escaped (feedback #34): it is normalised first, then matched exact,
 * case-insensitive, and finally case-insensitive with whitespace runs collapsed, since a name that
 * carries an embedded newline in Tally reaches the caller as a single space. When nothing matches, the
 * error says so and lists the closest names; when several match, it lists them all so the caller can
 * pick one via list-master instead of guessing
 */
async function resolveLookupName(collection, name, targetCompany) {
    const label = collection.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const targetName = utility.String.normaliseName(name);
    if (targetName === '')
        throw new Error(`No ${label} name was given. Kindly pass the exact name as returned by list-master tool with collection as ${collection.toLowerCase()}`);
    // cheap path first: Tally compares $$IsEqual case-insensitively, so this covers nearly every call
    const lstExact = await queryCollection(collection, ['Name'], new Map([['Exact_Name', `$$IsEqual:$Name:"${tdlString(targetName)}"`]]), targetCompany);
    if (lstExact.length === 1)
        return lstExact[0].Name;
    // tolerant path: fetch every name once and match after normalisation
    const lstAll = lstExact.length > 1 ? lstExact : await queryCollection(collection, ['Name'], new Map(), targetCompany);
    const lstName = lstAll.map((item) => item.Name);
    const targetKey = utility.String.nameKey(targetName);
    let lstMatch = lstName.filter((item) => item === targetName);
    if (lstMatch.length === 0)
        lstMatch = lstName.filter((item) => item.toLowerCase() === targetName.toLowerCase());
    if (lstMatch.length === 0)
        lstMatch = lstName.filter((item) => utility.String.nameKey(item) === targetKey);
    if (lstMatch.length === 1)
        return lstMatch[0];
    if (lstMatch.length > 1)
        throw new Error(`${lstMatch.length} ${label} masters match "${targetName}" after entity decoding and whitespace normalisation: ${lstMatch.map((item) => `"${item}"`).join(', ')}. Kindly pass one of them exactly as listed by list-master tool with collection as ${collection.toLowerCase()}`);
    // nothing matched: shortlist near names by substring, then by shared leading words, capped at five
    const lstWord = targetKey.split(' ').filter((word) => word.length > 2);
    const lstNear = lstName
        .map((item) => ({ item, key: utility.String.nameKey(item) }))
        .filter((entry) => entry.key.includes(targetKey) || targetKey.includes(entry.key) || lstWord.some((word) => entry.key.includes(word)))
        .sort((a, b) => Math.abs(a.key.length - targetKey.length) - Math.abs(b.key.length - targetKey.length))
        .slice(0, 5)
        .map((entry) => `"${entry.item}"`);
    throw new Error(`No ${label} named "${targetName}" found in Tally (names are matched after entity decoding and whitespace normalisation, so "&amp;" and "&" are treated alike). ${lstNear.length > 0 ? `Closest names: ${lstNear.join(', ')}. ` : ''}Kindly validate the name using list-master tool with collection as ${collection.toLowerCase()}`);
}
/**
 * Parses a YYYY-MM-DD input into a local date. new Date('YYYY-MM-DD') resolves to UTC
 * midnight, which shifts the date by a day for timezones behind UTC
 */
function parseInputDate(value) {
    return utility.Date.parse(value, 'yyyy-MM-dd') || new Date(value);
}
/**
 * Rounds an amount to 2 decimal places, so that floating point noise does not
 * unbalance a voucher when Tally validates it
 */
function roundAmount(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
/**
 * Feedback #33: bs_pl on chart-of-accounts is the Profit & Loss (true) / Balance Sheet (false) nature of a ledger.
 * Approach chosen: Tally's own $IsRevenue on the ledger is used first. Tally fixes that flag on the 28 reserved
 * primary groups and inherits it down every sub-group to the ledger, so it is by construction the PRIMARY group's
 * nature and survives user-renamed sub-groups (the profit-and-loss / balance-sheet tools filter on the same flag,
 * so the three tools stay consistent). The value was constant false only because the TDL answers 1 / 0 and the
 * parser accepted "Yes" alone; that coercion is now shared (parseTallyBoolean in tally.mts).
 * Fallback: when Tally answers blank for a ledger, the nature is derived from the primary group name using the
 * six revenue primaries (Sales Accounts, Purchase Accounts, Direct Incomes, Direct Expenses, Indirect Incomes,
 * Indirect Expenses -> true, every other primary -> false). When the primary group is blank too the row keeps
 * null so the caller sees the gap instead of a silent false
 */
const lstProfitLossPrimaryGroup = ['sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses'];
function resolveBsPl(isRevenue, primaryGroup) {
    if (typeof isRevenue === 'boolean')
        return isRevenue;
    const groupName = typeof primaryGroup === 'string' ? primaryGroup.trim().toLowerCase() : '';
    if (!groupName)
        return null;
    return lstProfitLossPrimaryGroup.includes(groupName);
}
/**
 * Fetches books beginning date of the target company (or the active company when not specified),
 * which Tally requires as the applicable from date for mailing / GST details of masters
 */
async function resolveBooksBeginFrom(targetCompany) {
    const lstCompany = await queryCollection('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map());
    if (lstCompany.length === 0)
        throw new Error('No company found in Tally to determine books begin from date');
    const objCompany = targetCompany
        ? lstCompany.find((item) => item.Name === targetCompany)
        : lstCompany.find((item) => item.IsActiveCompany);
    if (!objCompany)
        throw new Error(targetCompany
            ? `No company found with name ${targetCompany}. Kindly validate it using list-master tool with collection as company`
            : 'No active company found in Tally. Kindly open a company in Tally or specify targetCompany');
    return objCompany.BooksFrom;
}
/**
 * Validates master names against Tally before a write is attempted and maps every input name
 * to the exact name stored in Tally (case-insensitive match), so that a stray letter casing
 * does not end up creating a duplicate master or a rejected voucher
 */
async function resolveMasterNames(collection, lstName, targetCompany) {
    const lstTargetName = Array.from(new Set(lstName.filter((name) => typeof name === 'string' && name.trim() !== ''))); //matched below via nameKey, so a raw or escaped spelling both resolve
    if (lstTargetName.length === 0)
        return new Map();
    const lstMaster = await queryCollection(collection, ['Name'], new Map(), targetCompany);
    const lstExistingName = new Map();
    lstMaster.forEach((item) => lstExistingName.set(utility.String.nameKey(item.Name), item.Name));
    const lstResolvedName = new Map();
    const lstMissingName = [];
    lstTargetName.forEach((name) => {
        const exactName = lstExistingName.get(utility.String.nameKey(name));
        if (exactName)
            lstResolvedName.set(name, exactName);
        else
            lstMissingName.push(name);
    });
    if (lstMissingName.length > 0)
        throw new Error(`Following ${collection} master(s) do not exist in Tally: ${lstMissingName.join(', ')}. Kindly validate them using list-master tool and create them before retrying`);
    return lstResolvedName;
}
export async function registerMcpServer() {
    const mcpServer = new McpServer({
        name: 'Tally Prime MCP Server',
        title: 'Tally Prime',
        version: resolveServerVersion()
    }, {
        instructions: 'Several Tally Prime instances may run at once on this machine, each on its own port. At the start of every conversation, before calling any data or write tool, call list-tally-instances. If exactly one Tally answers, call set-tally-connection with that port and tell the user which port and companies you connected to. If more than one answers, show the user the ports with their companies and ask which one to use, then call set-tally-connection with the chosen port. If none answers, tell the user to enable the XML server in Tally (F1 > Settings > Connectivity > Client/Server configuration with TallyPrime acting as Server). The chosen connection stays in effect until it is changed with set-tally-connection or until this server process restarts, so a previous conversation may have left a different port selected. Always re-check at the start of a conversation rather than assuming the port. Master names (ledger, group, company, stock item, party, voucher type) are returned decoded and normalised: XML character references are resolved and leading, trailing and embedded control characters (CR, LF, TAB) are stripped, so a name taken from any tool output can be passed verbatim to any tool input. Name inputs are accepted in raw or escaped form and matched after the same normalisation; when a name is not found the error lists the closest names. Every data and write tool requires targetCompany naming one of the companies open in Tally, exactly as listed by server-info or list-tally-instances; there is no session-level company selection and the company Tally has in focus is never used as a default. Every response echoes the company it was served from in a company property, and every cached table carries a company column, so assert the company before using a figure'
    });
    mcpServer.registerTool('server-info', {
        title: 'Server Info',
        description: `returns the build and connectivity state of this Tally Prime MCP server: its version, whether write tools are exposed, the Tally host and port it currently talks to (which may have been changed from the installed default by set-tally-connection in this or an earlier conversation), whether Tally answered, the list of companies open in Tally and which one is active. every data and write tool requires targetCompany naming one of the companies listed here, exactly as listed, so call this to learn the names. call it as well whenever a tool returns no data or behaves unexpectedly, since an unreachable Tally and a Tally with no company loaded both look like empty results everywhere else`,
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async () => {
        const objConnection = getTallyConnection();
        const objInfo = {
            version: resolveServerVersion(),
            writeToolsEnabled: !isWriteBlocked,
            tallyHost: objConnection.host,
            tallyPort: objConnection.port,
            connectionSource: objConnection.source,
            defaultTallyHost: process.env.TALLY_HOST || 'localhost',
            defaultTallyPort: parseInt(process.env.TALLY_PORT || '9000')
        };
        try {
            const lstCompany = await queryCollection('Company', ['Name', 'BooksFrom', 'IsActiveCompany'], new Map());
            const objActiveCompany = lstCompany.find((item) => item.IsActiveCompany);
            objInfo.tallyReachable = true;
            objInfo.companies = lstCompany.map((item) => item.Name);
            objInfo.activeCompany = objActiveCompany ? objActiveCompany.Name : null;
            objInfo.booksFrom = objActiveCompany && objActiveCompany.BooksFrom instanceof Date ? utility.Date.format(objActiveCompany.BooksFrom, 'yyyy-MM-dd') : null;
            if (lstCompany.length === 0) {
                objInfo.diagnosis = 'Tally answered but reported no company. Open a company in Tally (Company > Open) before calling any other tool, since every report and every write needs a company context';
            }
            else if (!objActiveCompany) {
                objInfo.diagnosis = 'Companies are loaded in Tally but none is active. Every data and write tool requires targetCompany, so pass one of the companies listed here on each call';
            }
            else {
                objInfo.diagnosis = 'Tally is reachable. Every data and write tool requires targetCompany naming one of the companies listed here, exactly as listed; the active company is informational only and is never used as a default';
            }
        }
        catch (err) {
            objInfo.tallyReachable = false;
            objInfo.diagnosis = `Tally did not answer on ${objInfo.tallyHost}:${objInfo.tallyPort}. Ensure Tally Prime is running and its XML server is enabled from Help (F1) > Settings > Connectivity > Client/Server configuration with TallyPrime acting as Server. If several Tally instances run on this machine, call list-tally-instances to find the right port and set-tally-connection to switch`;
            objInfo.error = formatError(err);
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(objInfo) }]
        };
    });
    mcpServer.registerTool('list-tally-instances', {
        title: 'List Tally Instances',
        description: `scans a port range on the given host for running Tally Prime instances and returns each answering port with the companies open in it and which of them is active. several Tally Prime instances may run at once on different ports, so this must be called at the start of every conversation to pick the right Tally before any data or write tool is used, followed by set-tally-connection with the chosen port. scanning the default range 9000 to 9999 takes a few seconds; narrow fromPort and toPort when the ports in use are known`,
        inputSchema: {
            host: z.string().optional().describe('optional host name or IP address to scan, defaults to the host of the current connection'),
            fromPort: z.number().int().min(1).max(65535).optional().describe('optional first port of the range to scan, default is 9000'),
            toPort: z.number().int().min(1).max(65535).optional().describe('optional last port of the range to scan, default is 9999')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const targetHost = args.host || getTallyConnection().host;
            const fromPort = args.fromPort ?? 9000;
            const toPort = args.toPort ?? 9999;
            if (fromPort > toPort) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `fromPort ${fromPort} is greater than toPort ${toPort}` }]
                };
            }
            const lstInstance = await scanTallyInstances(targetHost, fromPort, toPort);
            let hint;
            if (lstInstance.length === 0) {
                hint = `No Tally Prime instance answered on ${targetHost} between ports ${fromPort} and ${toPort}. Tell the user to ensure Tally Prime is running and its XML server is enabled from Help (F1) > Settings > Connectivity > Client/Server configuration with TallyPrime acting as Server`;
            }
            else if (lstInstance.length === 1) {
                const objInstance = lstInstance[0];
                hint = `Exactly one Tally Prime instance answered on port ${objInstance.port} with ${objInstance.companies.length} company(s) open${objInstance.activeCompany ? `, active company ${objInstance.activeCompany}` : ''}. Call set-tally-connection with port ${objInstance.port} and tell the user which port and companies you connected to`;
            }
            else {
                hint = `${lstInstance.length} Tally Prime instances answered on ports ${lstInstance.map((item) => item.port).join(', ')}. Show the user each port with its companies and ask the user which port to use, then call set-tally-connection with the chosen port`;
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            host: targetHost,
                            fromPort,
                            toPort,
                            scannedPorts: toPort - fromPort + 1,
                            instances: lstInstance,
                            currentConnection: getTallyConnection(),
                            hint
                        })
                    }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('set-tally-connection', {
        title: 'Set Tally Connection',
        description: `sets the Tally Prime host and port used by every subsequent tool call in this server process, reads and writes alike, until it is changed again by another call to this tool or the server restarts. the port is probed before it is accepted, so an unreachable port leaves the previous connection in place and returns an error. call list-tally-instances first to find which ports have a Tally answering and which companies each one has open`,
        inputSchema: {
            port: z.number().int().min(1).max(65535).describe('port on which the target Tally Prime instance serves XML requests, as reported by list-tally-instances'),
            host: z.string().optional().describe('optional host name or IP address of the target Tally Prime instance, defaults to the host of the current connection')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        const objPrevious = getTallyConnection();
        try {
            const objConnection = setTallyConnection(args.port, args.host);
            const objInstance = await probeTallyInstance(objConnection.host, objConnection.port);
            if (!objInstance) {
                // Revert so that a mistyped port does not leave every later tool call pointing at nothing
                if (objPrevious.source === 'default')
                    resetTallyConnection();
                else
                    setTallyConnection(objPrevious.port, objPrevious.host);
                return {
                    isError: true,
                    content: [{ type: 'text', text: `No Tally Prime instance answered on ${objConnection.host}:${objConnection.port}. The connection stays on ${objPrevious.host}:${objPrevious.port}. Call list-tally-instances to find which ports have a Tally answering` }]
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            connection: objConnection,
                            companies: objInstance.companies,
                            activeCompany: objInstance.activeCompany,
                            booksFrom: objInstance.booksFrom,
                            message: `Connected to Tally on ${objConnection.host}:${objConnection.port} with ${objInstance.companies.length} companies open, active company ${objInstance.activeCompany ?? 'none'}`
                        })
                    }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('metadata-collection', {
        title: 'Metadata Collection',
        description: 'returns collections metadata with collection and description',
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async () => {
        const collections = lstCollectionFields.map(({ collection, description }) => ({
            collection,
            description
        }));
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(collections)
                }
            ]
        };
    });
    mcpServer.registerTool('metadata-fields', {
        title: 'Metadata Fields',
        description: 'returns fields metadata for the selected tally collection containing field name, optional description and data type which can be string, number, date or boolean',
        inputSchema: {
            collection: z.enum(lstCollections).describe('target collection to fetch field metadata')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        const fields = (lstCollectionFields.find((item) => item.collection === args.collection)?.fields ?? []).map((field) => {
            const lstFields = { ...field };
            // substitute amount, quantity and rate data types with number data type to make it more generic since these are all numeric fields
            if (lstFields.datatype === 'amount' || lstFields.datatype === 'quantity' || lstFields.datatype === 'rate') {
                lstFields.datatype = 'number';
            }
            // delete property expression from field if found
            if (lstFields.expression) {
                delete lstFields.expression;
            }
            return lstFields;
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(fields)
                }
            ]
        };
    });
    mcpServer.registerTool('query-option-values', {
        title: 'Query Option Values',
        description: 'returns predefined option values or drop-down values for the fields required for master and voucher creation, it returns back object array of pre-defined values',
        inputSchema: {
            optionName: z.enum(['country-state']).describe('option name to query')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        let retval = undefined;
        if (args.optionName === 'country-state')
            retval = lstOptionCountryState;
        else {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: 'Invalid option name'
                    }
                ]
            };
        }
        ;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(retval)
                }
            ]
        };
    });
    mcpServer.registerTool('query-database', {
        title: 'Query Database',
        description: `executes sql query on pglite postgres in-memory database for querying cached Tally Prime report data in table generated as output by other tools (in tableID property from tool output response). These tables are temporary and will be dropped after 15 minutes automatically. Use this tool to run complex analytical queries to aggregate, filter, sort results. Accepts a single read-only statement: SELECT, WITH ... SELECT (common table expressions, including WITH RECURSIVE and multiple CTEs), UNION / INTERSECT / EXCEPT and VALUES. Data-modifying statements (INSERT, UPDATE, DELETE, MERGE, TRUNCATE, CREATE, ALTER, DROP, GRANT, COPY, CALL, SELECT INTO) are refused anywhere in the query, including inside a CTE body, and the statement is executed inside a READ ONLY transaction so the cached tables cannot be changed. Only one statement per call; a second statement after a semicolon is refused. Every cached table carries a company column naming the Tally company its rows came from, so a table can be tied back to its company at any time`,
        inputSchema: {
            sql: z.string().describe('SQL query to execute on pglite postgres in-memory database. Must be a single read-only statement: SELECT or WITH ... SELECT (CTEs are accepted). UPDATE, DELETE, INSERT, DDL and data-modifying CTEs are refused, and execution is wrapped in a READ ONLY transaction'),
            outputFormat: z.enum(['JSON Array of Objects', 'JSON with Schema and Rows', 'CSV', 'Markdown Table']).optional().describe('optional output format, default is JSON Array of Objects. JSON Array of Objects = [{"column1": "value1", "column2": "value2"}, {...}] , JSON with Schema and Rows = {"schema": ["column1", "column2"], "rows": [["value1", "value2"], [...]]}, CSV = comma separated values with header, Markdown Table = table format with header in markdown syntax which can be directly rendered in markdown supported viewers')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        const resp = await executeSQL(args.sql, args.outputFormat || 'JSON Array of Objects');
        return {
            content: [{ type: 'text', text: resp }]
        };
    });
    mcpServer.registerTool('query-collection', {
        title: 'Query Collection',
        description: `queries a Tally Prime collection with selected fields and optional reporting period. result is cached in pglite postgres in-memory table and returned as tableID. Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            collection: z.enum(lstCollections).describe('collection name to query, validate it using metadata-collection tool with exact collection name'),
            fields: z.array(z.string()).min(1).describe('list of field names to fetch for the selected collection. validate it using metadata-fields resource for that collection'),
            targetCompany: targetCompanySchema,
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional from date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional to date')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            const collection = args.collection.trim();
            const requestedFields = args.fields.map((field) => field.trim());
            const targetCollectionFields = lstCollectionFields.filter(p => p.collection == args.collection).map(p => p.fields)[0];
            // Validate that every requested field exists in the collection definition
            const validFieldNames = targetCollectionFields.map(f => f.name);
            const invalidFields = requestedFields.filter(f => !validFieldNames.includes(f));
            if (invalidFields.length > 0) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `The following fields do not exist in collection '${collection}': ${invalidFields.join(', ')}. Use metadata-fields resource to get valid field names.` }]
                };
            }
            const requestedFieldsMetadata = targetCollectionFields.filter(p => requestedFields.includes(p.name));
            const fromDate = args.fromDate ? new Date(args.fromDate) : undefined;
            const toDate = args.toDate ? new Date(args.toDate) : undefined;
            const result = await queryCollection(collection, requestedFields, new Map(), company, fromDate, toDate);
            // prepare Map of field name and data type for caching table metadata
            let fieldMetadataMap = new Map();
            requestedFieldsMetadata.forEach((field) => {
                if (field.datatype === 'amount' || field.datatype === 'quantity' || field.datatype === 'rate') {
                    fieldMetadataMap.set(field.name, 'number');
                }
                else if (field.datatype === 'date') {
                    fieldMetadataMap.set(field.name, 'date');
                }
                else if (field.datatype === 'boolean') {
                    fieldMetadataMap.set(field.name, 'boolean');
                }
                else {
                    fieldMetadataMap.set(field.name, 'string');
                }
            });
            const tableId = await cacheCompanyTable(fieldMetadataMap, result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableId, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('list-master', {
        title: 'List Masters',
        description: `fetches list of masters from Tally Prime collection e.g. group, ledger, vouchertype, unit, godown, stockgroup, stockitem, costcategory, costcentre, attendancetype, company, currency, gstin, gstclassification returns output in JSON string array in the property list. names are returned decoded and trimmed of control characters, exactly as other tools accept them. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            collection: z.enum(lstMasterCollection).describe('master collection whose names are to be listed'),
            containsFilter: z.string().optional().describe('optional filter to apply on name field with contains operator to filter results with respective name value or keywords, case insensitive')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let targetCollection = lstCollections.find((item) => item.toLowerCase() === args.collection.toLowerCase());
            if (!targetCollection) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'Invalid collection name' }]
                };
            }
            let lstFilters = new Map();
            if (args.containsFilter) {
                lstFilters.set('Search_Contains', `$Name CONTAINS "${utility.String.normaliseName(args.containsFilter).replace(/"/g, '')}"`); //filter accepted raw or escaped; strip double quotes to avoid TDL syntax error
            }
            let result = await queryCollection(targetCollection, ['Name'], lstFilters, company);
            return {
                content: [{ type: 'text', text: JSON.stringify({ list: result.map((item) => item.Name), company }) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('chart-of-accounts', {
        title: 'Chart of Accounts',
        description: `fetches chart of accounts or GL hierarchy with fields ledger_name, group_name, primary_group, bs_pl, dr_cr, affects_gross_profit, sort_position. bs_pl is the nature of the ledger's PRIMARY group (the root of its group tree): true = Profit & Loss ledger (primary group is one of Sales Accounts, Purchase Accounts, Direct Incomes, Direct Expenses, Indirect Incomes, Indirect Expenses), false = Balance Sheet ledger (every other primary group, e.g. Capital Account, Current Assets, Current Liabilities, Fixed Assets, Loans, Sundry Debtors, Sundry Creditors, Duties & Taxes), null = nature could not be resolved for that row. GROUP BY bs_pl therefore splits the Balance Sheet from the Profit & Loss. Column dr_cr as value true = Debit / false = Credit. primary_group is the primary group of parent or group, under which ledger is nested. The columns group and parent are tree structure represented in flat format. The column affects_gross_profit has values true / false, it is used to determine if ledger under this group will affect gross profit or not. sort_position determines position or placement order with respect to items of same level for display, returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let result = await queryCollection('Ledger', ['Name', 'Parent', '_PrimaryGroup', 'IsRevenue', 'IsDeemedPositive', 'AffectsGrossProfit', 'SortPosition'], new Map(), company);
            result = renameObjectArrayProperties(result, new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['_PrimaryGroup', 'primary_group'], ['IsRevenue', 'bs_pl'], ['IsDeemedPositive', 'dr_cr'], ['AffectsGrossProfit', 'affects_gross_profit'], ['SortPosition', 'sort_position']]));
            result = result.map((row) => ({ ...row, bs_pl: resolveBsPl(row.bs_pl, row.primary_group) })); //feedback #33: primary-group fallback, null when unresolved
            let tableID = await cacheCompanyTable(new Map([['ledger_name', 'string'], ['group_name', 'string'], ['primary_group', 'string'], ['bs_pl', 'boolean'], ['dr_cr', 'boolean'], ['affects_gross_profit', 'boolean'], ['sort_position', 'number']]), result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableID, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('trial-balance', {
        title: 'Trial Balance',
        description: `fetches trial balance with fields ledger_name, group_name (blank if Profit & Loss), opening_balance, net_debit, net_credit, closing_balance. opening_balance and closing_balance negative is debit and positive is credit. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('from or start date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('to or end date'),
            group_name: z.string().optional().describe('optional group name to filter trial balance results, validate it using list-master tool with collection as group if required')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let lstFilters = new Map();
            if (args.group_name) {
                lstFilters.set('Specific_Group', `$$IsEqual:$Parent:"${tdlString(await resolveLookupName('Group', args.group_name, company))}"`); //group name accepted raw or escaped; a miss lists near matches
            }
            let result = await queryCollection('Ledger', ['Name', 'Parent', 'OpeningBalance', 'DebitTotals', 'CreditTotals', 'ClosingBalance'], lstFilters, company, new Date(args.fromDate), new Date(args.toDate));
            result = renameObjectArrayProperties(result, new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['OpeningBalance', 'opening_balance'], ['DebitTotals', 'net_debit'], ['CreditTotals', 'net_credit'], ['ClosingBalance', 'closing_balance']]));
            let tableID = await cacheCompanyTable(new Map([['ledger_name', 'string'], ['group_name', 'string'], ['opening_balance', 'amount'], ['net_debit', 'amount'], ['net_credit', 'amount'], ['closing_balance', 'amount']]), result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableID, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('profit-loss', {
        title: 'Profit and Loss',
        description: `fetches profit and loss statement with fields like ledger_name, group_name, closing_balance. closing_balance negative is debit or expense and positive is credit or income. closing stock to be treated as credit, kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. for detailed ledger level analysis call trial-balance tool, returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('from or start date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('to or end date')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let result = [];
            // ledger rows
            let result_ledger = await queryCollection('Ledger', ['Name', 'Parent', 'ClosingBalance'], new Map([['PL_Group', '$IsRevenue']]), company, new Date(args.fromDate), new Date(args.toDate));
            result_ledger = renameObjectArrayProperties(result_ledger, new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['ClosingBalance', 'closing_balance']]));
            // opening and closing stock row
            let result_stock = await queryCollection('Group', ['Name', 'OpeningBalance', 'ClosingBalance'], new Map([['StockTypeGroup', '$$IsEqual:$Name:"Stock-in-Hand"']]), company, new Date(args.fromDate), new Date(args.toDate));
            if (result_stock.length > 0) {
                result.push({
                    ledger_name: 'Opening Stock',
                    group_name: 'Stock-in-Hand',
                    closing_balance: result_stock[0].OpeningBalance
                });
                result.push({
                    ledger_name: 'Closing Stock',
                    group_name: 'Stock-in-Hand',
                    closing_balance: -result_stock[0].ClosingBalance
                });
            }
            // merge ledger and stock results
            result.push(...result_ledger);
            let tableID = await cacheCompanyTable(new Map([['ledger_name', 'string'], ['group_name', 'string'], ['closing_balance', 'amount']]), result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableID, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('balance-sheet', {
        title: 'Balance Sheet',
        description: `fetches balance sheet with fields like ledger_name, group_name (blank if Profit & Loss A/c), closing_balance. closing balance negative is debit or asset and positive is credit or liability. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('period start or from date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('period end or to date')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let result = [];
            // ledger rows
            let result_ledger = await queryCollection('Ledger', ['Name', 'Parent', 'ClosingBalance'], new Map([['BS_Group', 'NOT $IsRevenue'], ['Excl_Stock', 'NOT $$IsGroupStock']]), company, new Date(args.fromDate), new Date(args.toDate));
            result_ledger = renameObjectArrayProperties(result_ledger, new Map([['Name', 'ledger_name'], ['Parent', 'group_name'], ['ClosingBalance', 'closing_balance']]));
            result.push(...result_ledger);
            // closing stock row
            let result_stock = await queryCollection('Group', ['Name', 'ClosingBalance'], new Map([['StockTypeGroup', '$$IsEqual:$Name:"Stock-in-Hand"']]), company, new Date(args.fromDate), new Date(args.toDate));
            if (result_stock.length > 0) {
                result.push({
                    ledger_name: 'Closing Stock',
                    group_name: 'Stock-in-Hand',
                    closing_balance: result_stock[0].ClosingBalance
                });
            }
            // profit loss row
            let result_pl = await queryCollection('Ledger', ['ClosingBalance'], new Map([['PL_Ledger', '$$IsEqual:$Name:"Profit & Loss A/c"']]), company, new Date(args.fromDate), new Date(args.toDate));
            if (result_pl.length > 0) {
                result.push({
                    ledger_name: 'Profit & Loss A/c',
                    group_name: '',
                    closing_balance: result_pl[0].ClosingBalance
                });
            }
            let tableID = await cacheCompanyTable(new Map([['ledger_name', 'string'], ['group_name', 'string'], ['closing_balance', 'amount']]), result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableID, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('stock-summary', {
        title: 'Stock Summary',
        description: `fetches stock item summary with fields stock_item_name, stock_group_name, opening_quantity, opening_value, inward_quantity, inward_value, outward_quantity, outward_value, closing_quantity, closing_value, returns output cached in pglite postgres in-memory table (specified in tableID property). synonyms (name=stock item / parent=stock group) Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('period start or from date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('period end or to date'),
            stockGroup: z.string().optional().describe('optional stock group name to filter stock summary results, validate it using list-master tool with collection as stock group if required')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let lstFilters = new Map();
            if (args.stockGroup) {
                lstFilters.set('Specific_StockGroup', `$$IsEqual:$Parent:"${tdlString(await resolveLookupName('StockGroup', args.stockGroup, company))}"`); //stock group accepted raw or escaped; a miss lists near matches
            }
            let result = await queryCollection('StockItem', ['Name', 'Parent', 'OpeningBalance', 'OpeningValue', 'InwardQuantity', 'InwardValue', 'OutwardQuantity', 'OutwardValue', 'ClosingBalance', 'ClosingValue', 'AffectsGrossProfit', 'SortPosition'], lstFilters, company, new Date(args.fromDate), new Date(args.toDate));
            result = renameObjectArrayProperties(result, new Map([['Name', 'stock_item_name'], ['Parent', 'stock_group_name'], ['OpeningBalance', 'opening_quantity'], ['OpeningValue', 'opening_value'], ['InwardQuantity', 'inward_quantity'], ['InwardValue', 'inward_value'], ['OutwardQuantity', 'outward_quantity'], ['OutwardValue', 'outward_value'], ['ClosingBalance', 'closing_quantity'], ['ClosingValue', 'closing_value']]));
            let tableID = await cacheCompanyTable(new Map([['stock_item_name', 'string'], ['stock_group_name', 'string'], ['opening_quantity', 'number'], ['opening_value', 'number'], ['inward_quantity', 'number'], ['inward_value', 'number'], ['outward_quantity', 'number'], ['outward_value', 'number'], ['closing_quantity', 'number'], ['closing_value', 'number']]), result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableID, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('ledger-balance', {
        title: 'Ledger Balance',
        description: `fetches ledger closing balance as on date, negative is debit and positive is credit, display Dr for Debit or Cr for Credit after the amount for better readability, instead of negative amount flip Debit or Credit to make it positive. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            ledgerName: z.string().describe('precise ledger name, always validate it using list-master tool with collection as ledger'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('as on date for which balance is required')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            const ledgerName = await resolveLookupName('Ledger', args.ledgerName, company); //accepts the name raw or escaped; throws a descriptive error listing near matches
            let lstFilters = new Map([['Exact_Ledger', `$$IsEqual:$Name:"${tdlString(ledgerName)}"`]]);
            let result = await queryCollection('Ledger', ['ClosingBalance'], lstFilters, company, undefined, parseInputDate(args.toDate));
            if (result.length > 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ ledger_name: ledgerName, amount: result[0].ClosingBalance, company }) }] };
            }
            else {
                return { isError: true, content: [{ type: 'text', text: `Ledger "${ledgerName}" exists in Tally but returned no balance row for the given date. Kindly validate the name using list-master tool with collection as ledger` }] };
            }
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('stock-item-balance', {
        title: 'Stock Item Balance',
        description: `fetches stock item remaining quantity balance as on date, tool returns quantity and unit of measurement. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            itemName: z.string().describe('precise stock item name, always validate it using list-master tool with collection as stockitem'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('as on date for which balance is required')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            const itemName = await resolveLookupName('StockItem', args.itemName, company); //accepts the name raw or escaped; throws a descriptive error listing near matches
            let lstFilters = new Map([['Exact_StockItem', `$$IsEqual:$Name:"${tdlString(itemName)}"`]]);
            let result = await queryCollection('StockItem', ['ClosingBalance', 'Unit'], lstFilters, company, undefined, parseInputDate(args.toDate));
            if (result.length === 0) {
                return { isError: true, content: [{ type: 'text', text: `Stock item "${itemName}" exists in Tally but returned no balance row for the given date. Kindly validate the name using list-master tool with collection as stockitem` }] };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify({ quantity: result[0].ClosingBalance, unit_of_measurement: result[0].Unit, company }) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('bills-outstanding', {
        title: 'Bills Outstanding',
        description: `fetches pending overdue outstanding bills receivable or payable as on date with fields bill_date,reference_number,outstanding_amount,party_name,overdue_days. outstanding_amount = Debit is negative and Credit is positive. party_name = ledger_name. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            nature: z.enum(['receivable', 'payable']),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('as on date')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        try {
            const company = await resolveTargetCompany(args.targetCompany);
            let lstFilters = new Map();
            if (args.nature) {
                lstFilters.set('Nature', `$$IsEqual:($_PrimaryGroup:Group:($Parent:Ledger:$Parent)):"${args.nature === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors'}"`);
            }
            let result = await queryCollection('Bill', ['BillDate', 'Name', 'ClosingBalance', 'Parent', '_OverDueDays'], lstFilters, company, undefined, new Date(args.toDate));
            result = renameObjectArrayProperties(result, new Map([['BillDate', 'bill_date'], ['Name', 'reference_number'], ['ClosingBalance', 'outstanding_amount'], ['Parent', 'party_name'], ['_OverDueDays', 'overdue_days']]));
            let tableID = await cacheCompanyTable(new Map([['bill_date', 'date'], ['reference_number', 'string'], ['outstanding_amount', 'number'], ['party_name', 'string'], ['overdue_days', 'number']]), result, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableID, result, company) }]
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    mcpServer.registerTool('ledger-account', {
        title: 'Ledger Account',
        description: `fetches GL ledger account statement with voucher level details containing fields guid, date, voucher_type, voucher_number, alternate_ledger, party_name, amount, narration . amount = debit is negative and credit is positive. alternate_ledger = if amount is credit then ledger by which it is debited and vice-a-versa (in case of multiple ledgers first one is displayed). the first row is a synthetic "Opening" row (voucher_type Opening, date = fromDate, amount = opening balance) and the last row is a synthetic "Closing" row (voucher_type Closing, date = toDate, amount = closing balance as Tally reports it for the period, the same figure trial-balance gives); both have a blank guid and are not vouchers. the response also carries a reconciliation check: reconciled (true when opening + sum of voucher amounts equals closing within 0.01), unexplainedMovement (closing minus opening minus voucher amounts, positive = credit not covered by the rows returned, negative = debit), openingBalance, closingBalance, voucherCount and, whenever reconciled is false, a note explaining why. reconciled false means the statement is incomplete and must not be read as "no transactions"; for a ledger under primary group Stock-in-Hand the movement is derived from stock values and has no vouchers or narration behind it, so use stock-summary instead. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            ledgerName: z.string().describe('ledger name, always verify if ledger exists using list-master tool with collection as ledger'),
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('from or start date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('to or end date')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        let company;
        try {
            company = await resolveTargetCompany(args.targetCompany);
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
        let inputParams = new Map([['fromDate', args.fromDate], ['toDate', args.toDate], ['ledgerName', args.ledgerName], ['targetCompany', company]]);
        // verify if ledger exists before making report call to avoid unnecessary processing and load on Tally.
        // the name is accepted raw or escaped and resolved to the spelling Tally holds; a miss lists near matches
        try {
            inputParams.set('ledgerName', await resolveLookupName('Ledger', args.ledgerName, company));
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
        const resp = await fetchReport('ledger-account', inputParams);
        if (resp.error) {
            return {
                isError: true,
                content: [{ type: 'text', text: resp.error }]
            };
        }
        else {
            const statement = assembleLedgerAccount(Array.isArray(resp.data) ? resp.data : []);
            const tableId = await cacheCompanyTable(new Map([['guid', 'string'], ['date', 'date'], ['voucher_type', 'string'], ['voucher_number', 'string'], ['alternate_ledger', 'string'], ['party_name', 'string'], ['amount', 'number'], ['narration', 'string']]), statement.rows, company);
            const result = JSON.parse(buildTableResult(tableId, statement.rows, company));
            if (statement.rows.length > 0) {
                Object.assign(result, statement.summary);
            }
            return {
                content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
            };
        }
    });
    mcpServer.registerTool('stock-item-account', {
        title: 'Stock Item Account',
        description: `fetches GL stock item account statement with voucher level details containing fields date, voucher_type, voucher_number, party_name, quantity, amount, narration, tracking_number, voucher_category. party_name = ledger_name. quantity = inward as positive and outward as negative. amount = debit is negative and credit is positive, narration = notes / remarks. for calculating closing balance of quantity, consider rows with tracking_number as empty as it is, but for rows with tracking_number having text value, then duplicate rows need to be removed by preparing intermediate output with aggregation of tracking_number and voucher_category with sum of quantity and then comparing quantity of Receipt Note with Purchase and Delivery Note with Sales to identify and remove the rows with Receipt Note and Delivery Note if they are found to be tracked fully / partially . returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the response echoes the company the data was served from in a company property, which should be asserted against the company intended before any figure is used`,
        inputSchema: {
            targetCompany: targetCompanySchema,
            itemName: z.string().describe('stock item name, validate it using list-master tool with collection as stockitem'),
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('from or start date'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('to or end date')
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false
        }
    }, async (args) => {
        let company;
        try {
            company = await resolveTargetCompany(args.targetCompany);
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
        let inputParams = new Map([['fromDate', args.fromDate], ['toDate', args.toDate], ['itemName', args.itemName], ['targetCompany', company]]);
        // verify if stock item exists before making report call to avoid unnecessary processing and load on Tally.
        // the name is accepted raw or escaped and resolved to the spelling Tally holds; a miss lists near matches
        try {
            inputParams.set('itemName', await resolveLookupName('StockItem', args.itemName, company));
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: 'text', text: formatError(err) }]
            };
        }
        const resp = await fetchReport('stock-item-account', inputParams);
        if (resp.error) {
            return {
                isError: true,
                content: [{ type: 'text', text: resp.error }]
            };
        }
        else {
            //swap opening balance row to the top since it came at the end from Tally XML response
            if (Array.isArray(resp.data) && resp.data.length > 0) {
                const lastItem = resp.data.pop();
                resp.data.unshift(lastItem);
            }
            const tableId = await cacheCompanyTable(new Map([['date', 'date'], ['voucher_type', 'string'], ['voucher_number', 'string'], ['party_ledger', 'string'], ['quantity', 'number'], ['amount', 'number'], ['narration', 'string'], ['tracking_number', 'string'], ['voucher_category', 'string']]), resp.data, company);
            return {
                content: [{ type: 'text', text: buildTableResult(tableId, resp.data, company) }]
            };
        }
    });
    // set-company was removed in v7.8.0: Tally did not reliably honour the switch for later requests,
    // so report calls which left targetCompany out were silently served from another company.
    // Every data and write tool now requires targetCompany on each call instead
    mcpServer.registerTool('set-period', {
        title: 'Set Period',
        description: `sets the active reporting period in Tally Prime by specifying a from date and to date. This changes the global period context used by Tally for subsequent report queries`,
        inputSchema: {
            fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('start date of the period'),
            toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('end date of the period')
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
            idempotentHint: true
        }
    }, async (args) => {
        try {
            let _fromDate = parseInputDate(args.fromDate);
            let _toDate = parseInputDate(args.toDate);
            if (_fromDate > _toDate) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `fromDate ${args.fromDate} falls after toDate ${args.toDate}` }]
                };
            }
            let inputParams = new Map([['SVFromDate', utility.Date.format(_fromDate, 'd-MMM-yyyy')], ['SVToDate', utility.Date.format(_toDate, 'd-MMM-yyyy')]]);
            await invokeTallyAction('Change Period', inputParams);
            return { content: [{ type: 'text', text: JSON.stringify({ fromDate: args.fromDate, toDate: args.toDate }) }] };
        }
        catch (err) {
            return {
                isError: true, content: [{ type: 'text', text: formatError(err) }]
            };
        }
    });
    if (!isWriteBlocked) {
        mcpServer.registerTool('ledger-create-update', {
            title: 'Create or Update Ledger',
            description: `create or update ledger master data in Tally Prime, returns success count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('ledger name or updated ledger name for modify / update'),
                    _name: z.string().optional().describe('old ledger name to modify / update, validate if ledger exists using list-master tool with collection as ledger'),
                    parent: z.string().optional().describe('group name for the ledger, validate if group exists using list-master tool with collection as group'),
                    openingBalance: z.number().optional().describe('optional opening balance for the ledger debit is negative and credit is positive'),
                    isBillWise: z.boolean().optional().describe('optional billwise or bill by bill tracking is enabled for the ledger, default is false, set it undefined to keep it unchanged'),
                    billCreditPeriod: z.number().optional().describe('optional bill credit period in number of days, applicable only if isBillWise is true, set it undefined to keep it unchanged'),
                    isCostCentre: z.boolean().optional().describe('optional, true if cost centres are applicable while passing vouchers with this ledger, set it undefined to keep it unchanged'),
                    email: z.string().optional().describe('optional email address of the ledger, set it blank to reset it, set it undefined to keep it unchanged'),
                    mobileNumber: z.string().optional().describe('optional contact or mobile number of the ledger, set it blank to reset it, set it undefined to keep it unchanged'),
                    bankDetails: z.object({
                        accountNumber: z.string().describe('bank account number'),
                        ifscCode: z.string().describe('IFSC code of the bank branch'),
                        bankName: z.string().optional().describe('optional name of the bank'),
                        accountHolderName: z.string().optional().describe('optional name of the account holder')
                    }).optional().describe('optional bank details of the ledger used for payment processing'),
                    mailingDetails: z.object({
                        name: z.string().optional().describe('business name for mailing details, set it undefined to keep it unchanged, set it blank to reset it to Not Applicable'),
                        country: z.string().describe('country for mailing details, validate it using query-option-values tool with input optionName as country-state, set it blank to reset it to Not Applicable'),
                        state: z.string().describe('state for mailing details, validate it using query-option-values tool with input optionName as country-state, set it blank to reset it to Not Applicable'),
                        address: z.array(z.string()).optional().describe('address for mailing details as an array of address lines'),
                        pincode: z.string().regex(/^\d{6}$/).optional().describe('pincode for mailing details 6 digit number, set it blank to reset it, set it undefined to keep it unchanged'),
                    }).optional().describe('optional mailing details for the ledger'),
                    gstRegistrationDetails: z.object({
                        gstin: z.string().regex(/^\d{2}[A-Za-z]{5}\d{4}[A-Za-z][A-Za-z\d]Z[A-Za-z\d]$/).describe('GSTIN or GST number, 15 character code like 27AAAAA0000A1Z5'),
                        registrationType: z.enum(['Composition', 'Regular', 'Unregistered/Consumer', 'Government entity / TDS', 'Regular - SEZ', 'Regular-Deemed Exporter', 'Regular-Exports (EOU)', 'e-Commerce Operator', 'Input Service Distributor', 'Embassy/UN Body', 'Non-Resident Taxpayer']).optional().describe('GST registration type'),
                        placeOfSupply: z.string().optional().describe('place of supply for GST, validate it using query-option-values tool with input optionName as country-state with value of state property, set it blank to reset it to Not Applicable, set it undefined to keep it unchanged'),
                    }).optional().describe('optional GST registration details for the ledger, applicable only if country in mailing details is India'),
                })).describe('array of master data objects to create or update'),
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                if (Array.isArray(args.masters) && args.masters.length > 0) {
                    let objMasterInput = new Map();
                    let lstObjMasters = [];
                    // assign books begin from date, which Tally expects as applicable from date of mailing / GST details
                    let booksBeginFrom = await resolveBooksBeginFrom(company);
                    args.masters.forEach((master) => {
                        let objLedger = {};
                        if (master._name)
                            objLedger._name = master._name;
                        if (master.name)
                            objLedger.name = master.name;
                        if (master.parent)
                            objLedger.parent = master.parent;
                        if (master.openingBalance !== undefined)
                            objLedger.openingBalance = master.openingBalance;
                        if (master.mailingDetails) {
                            objLedger.mailingDetails = master.mailingDetails;
                            objLedger.mailingDetails.applicableFrom = booksBeginFrom;
                        }
                        if (master.gstRegistrationDetails) {
                            objLedger.gstRegistrationDetails = master.gstRegistrationDetails;
                            objLedger.gstRegistrationDetails.applicableFrom = booksBeginFrom;
                        }
                        if (master.isBillWise !== undefined) {
                            objLedger.isBillWise = master.isBillWise;
                        }
                        if (master.isCostCentre !== undefined)
                            objLedger.isCostCentre = master.isCostCentre;
                        if (master.email !== undefined)
                            objLedger.email = master.email;
                        if (master.mobileNumber !== undefined)
                            objLedger.mobileNumber = master.mobileNumber;
                        if (master.bankDetails)
                            objLedger.bankDetails = master.bankDetails;
                        if (master.isBillWise === true && master.billCreditPeriod !== undefined && typeof master.billCreditPeriod === 'number') {
                            let creditDays = Math.trunc(master.billCreditPeriod);
                            objLedger.billCreditPeriod = creditDays;
                        }
                        lstObjMasters.push(objLedger);
                    });
                    objMasterInput.set('masters', await resolveMasterActions('Ledger', lstObjMasters, company));
                    objMasterInput.set('targetCompany', company);
                    let result = await importMasters('master-ledger', objMasterInput);
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                    };
                }
                else {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: 'masters array is required with at least one master object to create or update' }]
                    };
                }
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('delete-master', {
            title: 'Delete Master',
            description: `deletes a master object from selected collection in Tally Prime and returns success count of deleted records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                collection: z.enum(lstCollections).describe('target collection for deletion, validate collection and object name using list-master tool where applicable'),
                name: z.array(z.string()).describe('list of name of that specific master object from that collection to delete, validate it using list-master tool with collection as the target collection before calling this tool')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const targetCollection = args.collection.trim();
                // validate if name exists for the specified collection before making delete call to avoid unnecessary processing and load on Tally
                let lstNames = await queryCollection(targetCollection, ['Name'], new Map(), company);
                // iterate through args.name and check if each name exists in lstNames, if any name is not found then return error with list of names not found, if all names are found then proceed with delete operation
                let lstNamesNotFound = [];
                args.name.forEach((name) => {
                    if (!lstNames.some((item) => item.Name === name)) {
                        lstNamesNotFound.push(name);
                    }
                });
                if (lstNamesNotFound.length > 0) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `No master object found with the given name(s) in the ${targetCollection} collection: ${lstNamesNotFound.join(', ')}. Kindly validate it using list-master tool` }]
                    };
                }
                const result = await deleteMasters(targetCollection, args.name, company);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('group-create-update', {
            title: 'Create or Update Group',
            description: `create or update accounting group (chart of accounts node under which ledgers are nested) in Tally Prime, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('group name, or the new name when renaming an existing group'),
                    _name: z.string().optional().describe('existing group name to modify / rename, validate if group exists using list-master tool with collection as group'),
                    parent: z.string().optional().describe('parent group name under which this group is nested, validate if group exists using list-master tool with collection as group. skip it to create a primary group'),
                    isSubLedger: z.boolean().optional().describe('optional, true if group behaves like a sub-ledger, set it undefined to keep it unchanged'),
                    isNettBalance: z.boolean().optional().describe('optional, true to nett debit / credit balances of ledgers of this group while reporting, set it undefined to keep it unchanged'),
                    isCostCentre: z.boolean().optional().describe('optional, true if cost centres are applicable for ledgers of this group, set it undefined to keep it unchanged')
                })).min(1).describe('array of group master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Group', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-group', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('stock-group-create-update', {
            title: 'Create or Update Stock Group',
            description: `create or update stock group (group under which stock items are nested) in Tally Prime, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('stock group name, or the new name when renaming an existing stock group'),
                    _name: z.string().optional().describe('existing stock group name to modify / rename, validate if stock group exists using list-master tool with collection as stockgroup'),
                    parent: z.string().optional().describe('parent stock group name under which this stock group is nested, validate it using list-master tool with collection as stockgroup. skip it to create a primary stock group'),
                    isQuantityAddable: z.boolean().optional().describe('optional, true if quantities of stock items of this stock group can be added together, set it undefined to keep it unchanged')
                })).min(1).describe('array of stock group master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('StockGroup', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-stock-group', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('unit-create-update', {
            title: 'Create or Update Unit of Measurement',
            description: `create or update unit of measurement used by stock items in Tally Prime, supports simple unit (like Nos, Kgs) and compound unit (like Box of 12 Nos), returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('symbol of the unit like Nos, Kgs, Ltr. for a compound unit Tally derives the name itself from base unit, additional unit and conversion'),
                    _name: z.string().optional().describe('existing unit name to modify / rename, validate if unit exists using list-master tool with collection as unit'),
                    formalName: z.string().optional().describe('optional full name of a simple unit like Numbers for Nos, Kilograms for Kgs'),
                    decimalPlaces: z.number().int().min(0).max(4).optional().describe('optional number of decimal places allowed for quantity of a simple unit, default is 0'),
                    baseUnit: z.string().optional().describe('base unit of a compound unit, validate it using list-master tool with collection as unit. specify baseUnit, additionalUnit and conversion together to create a compound unit'),
                    additionalUnit: z.string().optional().describe('additional unit of a compound unit, validate it using list-master tool with collection as unit'),
                    conversion: z.number().positive().optional().describe('number of base units contained in one additional unit, example 12 for Box of 12 Nos')
                })).min(1).describe('array of unit master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                // a compound unit is meaningless unless all the 3 constituents are supplied together
                const objIncompleteUnit = args.masters.find((master) => (master.baseUnit || master.additionalUnit || master.conversion !== undefined)
                    && !(master.baseUnit && master.additionalUnit && master.conversion !== undefined));
                if (objIncompleteUnit) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Unit ${objIncompleteUnit.name} is a compound unit, so baseUnit, additionalUnit and conversion must be specified together` }]
                    };
                }
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Unit', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-unit', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('godown-create-update', {
            title: 'Create or Update Godown',
            description: `create or update godown or warehouse or storage location of stock items in Tally Prime, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('godown name, or the new name when renaming an existing godown'),
                    _name: z.string().optional().describe('existing godown name to modify / rename, validate if godown exists using list-master tool with collection as godown'),
                    parent: z.string().optional().describe('parent godown name under which this godown is nested, validate it using list-master tool with collection as godown. skip it to create a primary godown'),
                    address: z.array(z.string()).optional().describe('optional address of the godown as an array of address lines'),
                    isExternal: z.boolean().optional().describe('optional, true if the godown is a third party location where stock is stored, set it undefined to keep it unchanged')
                })).min(1).describe('array of godown master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Godown', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-godown', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('cost-category-create-update', {
            title: 'Create or Update Cost Category',
            description: `create or update cost category used to group cost centres for parallel allocation in Tally Prime, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('cost category name, or the new name when renaming an existing cost category'),
                    _name: z.string().optional().describe('existing cost category name to modify / rename, validate it using list-master tool with collection as costcategory'),
                    allocateRevenue: z.boolean().optional().describe('optional, true if revenue items like income and expenses can be allocated to cost centres of this category, set it undefined to keep it unchanged'),
                    allocateNonRevenue: z.boolean().optional().describe('optional, true if non-revenue items like assets and liabilities can be allocated to cost centres of this category, set it undefined to keep it unchanged')
                })).min(1).describe('array of cost category master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('CostCategory', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-cost-category', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('cost-centre-create-update', {
            title: 'Create or Update Cost Centre',
            description: `create or update cost centre or profit centre used to track income and expenses of a department, branch, project or employee in Tally Prime, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('cost centre name, or the new name when renaming an existing cost centre'),
                    _name: z.string().optional().describe('existing cost centre name to modify / rename, validate it using list-master tool with collection as costcentre'),
                    category: z.string().optional().describe('cost category under which the cost centre is nested, validate it using list-master tool with collection as costcategory. default is Primary Cost Category'),
                    parent: z.string().optional().describe('parent cost centre name under which this cost centre is nested, validate it using list-master tool with collection as costcentre. skip it to create a primary cost centre')
                })).min(1).describe('array of cost centre master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('CostCentre', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-cost-centre', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('stock-item-create-update', {
            title: 'Create or Update Stock Item',
            description: `create or update stock item (product or material forming part of inventory) in Tally Prime, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('stock item name, or the new name when renaming an existing stock item'),
                    _name: z.string().optional().describe('existing stock item name to modify / rename, validate if stock item exists using list-master tool with collection as stockitem'),
                    parent: z.string().optional().describe('stock group name under which the stock item is nested, validate it using list-master tool with collection as stockgroup'),
                    category: z.string().optional().describe('optional stock category name of the stock item, set it blank to reset it to Not Applicable, set it undefined to keep it unchanged'),
                    unit: z.string().optional().describe('base unit of measurement of the stock item, validate it using list-master tool with collection as unit and create it using unit-create-update tool if it does not exist'),
                    alternateUnit: z.string().optional().describe('optional alternate or additional unit of measurement, validate it using list-master tool with collection as unit. must be supplied along with conversion'),
                    conversion: z.number().positive().optional().describe('number of base units contained in one alternate unit, mandatory when alternateUnit is specified'),
                    description: z.string().optional().describe('optional description or remarks of the stock item'),
                    costingMethod: z.enum(lstCostingMethod).optional().describe('optional method of valuation of stock, default is Avg. Cost'),
                    isBatchWise: z.boolean().optional().describe('optional, true to maintain the stock item batch wise, set it undefined to keep it unchanged'),
                    openingQuantity: z.number().optional().describe('optional opening quantity of the stock item as on books begin date'),
                    openingRate: z.number().optional().describe('optional opening rate per base unit, applicable only when openingQuantity is specified'),
                    openingValue: z.number().optional().describe('optional opening value (quantity multiplied by rate), applicable only when openingQuantity is specified'),
                    gstDetails: z.object({
                        hsnCode: z.string().optional().describe('HSN code for goods or SAC code for services'),
                        hsnDescription: z.string().optional().describe('description of the HSN or SAC code'),
                        typeOfSupply: z.enum(['Goods', 'Services']).optional().describe('GST type of supply, default is Goods'),
                        taxability: z.enum(['Taxable', 'Exempt', 'Nil Rated']).optional().describe('GST taxability of the stock item, default is Taxable'),
                        rate: z.number().min(0).max(100).describe('total GST rate in percentage, which is split internally as half into CGST and half into SGST and full into IGST')
                    }).optional().describe('optional GST details of the stock item, applicable for companies with GST enabled')
                })).min(1).describe('array of stock item master objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const objIncompleteUnit = args.masters.find((master) => master.alternateUnit && master.conversion === undefined);
                if (objIncompleteUnit) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Stock item ${objIncompleteUnit.name} specifies alternateUnit, so conversion is mandatory` }]
                    };
                }
                const isGstRequired = args.masters.some((master) => master.gstDetails);
                // GST details of a stock item are applicable from a date, for which Tally expects books begin date
                let booksBeginFrom = isGstRequired ? await resolveBooksBeginFrom(company) : undefined;
                let lstObjMasters = args.masters.map((master) => {
                    let objStockItem = { ...master };
                    if (master.gstDetails) {
                        objStockItem.gstDetails = {
                            applicableFrom: booksBeginFrom,
                            hsnCode: master.gstDetails.hsnCode,
                            hsnDescription: master.gstDetails.hsnDescription || master.gstDetails.hsnCode,
                            typeOfSupply: master.gstDetails.typeOfSupply || 'Goods',
                            taxability: master.gstDetails.taxability || 'Taxable',
                            cgstRate: master.gstDetails.rate / 2,
                            sgstRate: master.gstDetails.rate / 2,
                            igstRate: master.gstDetails.rate
                        };
                    }
                    return objStockItem;
                });
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('StockItem', lstObjMasters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-stock-item', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('voucher-create-update', {
            title: 'Create or Update Voucher',
            description: `creates accounting and / or inventory vouchers (transactions like payment, receipt, contra, journal, sales, purchase, debit note, credit note, delivery note, receipt note, stock journal) in Tally Prime, or updates an existing voucher when its guid is supplied. amount convention is debit is negative and credit is positive, and the sum of all amounts of a voucher must be zero. quantity is always an absolute positive number, since inward or outward movement is derived by Tally from the voucher type. when guid is supplied the voucher is fully replaced by the supplied content, so send every entry of that voucher and not just the changed one. guid of an existing voucher can be picked from the output of ledger-account tool. returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                vouchers: z.array(z.object({
                    guid: z.string().optional().describe('optional guid of an existing voucher to update it, obtained from ledger-account tool. skip it to create a new voucher'),
                    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('voucher date, must fall within the financial year of the company'),
                    voucherType: z.string().describe('voucher type name like Payment, Receipt, Contra, Journal, Sales, Purchase, Credit Note, Debit Note, Delivery Note, Receipt Note, validate it using list-master tool with collection as vouchertype'),
                    voucherNumber: z.string().optional().describe('optional voucher number, skip it to let Tally auto-number the voucher as per the numbering method of the voucher type'),
                    reference: z.string().optional().describe('optional reference like purchase order number or supplier invoice number'),
                    referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional date of the reference'),
                    partyLedgerName: z.string().optional().describe('optional party ledger name of the voucher, validate it using list-master tool with collection as ledger'),
                    narration: z.string().optional().describe('optional narration or remarks of the voucher'),
                    objectView: z.enum(lstVoucherView).optional().describe('optional voucher view. skipping it picks Invoice Voucher View when both ledger and inventory entries are present, Inventory Voucher View when only inventory entries are present and Accounting Voucher View otherwise'),
                    ledgerEntries: z.array(z.object({
                        ledgerName: z.string().describe('ledger name of the entry, validate it using list-master tool with collection as ledger'),
                        amount: z.number().describe('amount of the entry, debit is negative and credit is positive'),
                        billAllocations: z.array(z.object({
                            name: z.string().describe('bill number or reference number of the bill'),
                            billType: z.enum(lstBillType).describe('New Ref for a fresh bill raised, Agst Ref to settle an existing bill (validate the bill using bills-outstanding tool), Advance for an advance received or paid, On Account when the amount cannot be linked to any bill'),
                            amount: z.number().describe('amount allocated to this bill, debit is negative and credit is positive, sum of all bill allocations must equal amount of the ledger entry'),
                            creditPeriod: z.number().int().positive().optional().describe('optional credit period in number of days, applicable for billType as New Ref')
                        })).optional().describe('bill wise allocation, mandatory for a ledger on which bill wise details is enabled like sundry debtors and sundry creditors'),
                        costCentreAllocations: z.array(z.object({
                            costCategory: z.string().optional().describe('cost category name, validate it using list-master tool with collection as costcategory. default is Primary Cost Category'),
                            costCentre: z.string().describe('cost centre name, validate it using list-master tool with collection as costcentre'),
                            amount: z.number().describe('amount allocated to this cost centre, debit is negative and credit is positive, sum of all cost centre allocations must equal amount of the ledger entry')
                        })).optional().describe('optional cost centre allocation, applicable for a ledger on which cost centres are enabled')
                    })).describe('accounting entries of the voucher. leave it as an empty array only for a pure inventory voucher like Delivery Note or Receipt Note which carries no accounting effect'),
                    inventoryEntries: z.array(inventoryEntrySchema).optional().describe('optional inventory entries of the voucher, applicable for inventory affecting voucher types like Sales, Purchase, Delivery Note, Receipt Note. do not use it for a Stock Journal, which uses sourceEntries and destinationEntries instead'),
                    sourceEntries: z.array(inventoryEntrySchema).optional().describe('source or consumption side of a Stock Journal / Manufacturing Journal, i.e. the stock which is consumed or transferred out. amount is positive (credit) for stock going out'),
                    destinationEntries: z.array(inventoryEntrySchema).optional().describe('destination or production side of a Stock Journal / Manufacturing Journal, i.e. the stock which is produced or transferred in. amount is negative (debit) for stock coming in')
                })).min(1).describe('array of vouchers to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: false
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                // arithmetic is checked first because it costs nothing. Resolving master names needs a
                // round trip to Tally and short circuits on the first missing name, which would otherwise
                // leave an unbalanced voucher or a mismatched allocation undetected until the name is fixed
                for (const voucher of args.vouchers) {
                    const lstBillTotal = voucher.ledgerEntries.map((entry) => roundAmount((entry.billAllocations || []).reduce((total, bill) => total + bill.amount, 0)));
                    const lstCostCentreTotal = voucher.ledgerEntries.map((entry) => roundAmount((entry.costCentreAllocations || []).reduce((total, allocation) => total + allocation.amount, 0)));
                    // Tally rejects an unbalanced voucher, so it is validated before the request is fired
                    if (voucher.ledgerEntries.length > 0) {
                        const totalAmount = roundAmount(voucher.ledgerEntries.reduce((total, entry) => total + entry.amount, 0)
                            + (voucher.inventoryEntries || []).filter((item) => item.accountingLedger).reduce((total, item) => total + item.amount, 0));
                        if (Math.abs(totalAmount) > 0.005) {
                            return {
                                isError: true,
                                content: [{ type: 'text', text: `Voucher of type ${voucher.voucherType} dated ${voucher.date} is not balanced. Sum of all amounts is ${totalAmount} whereas it must be 0. Kindly note that debit is negative and credit is positive` }]
                            };
                        }
                    }
                    // Tally rejects bill wise and cost centre allocations which do not add up to the ledger entry
                    for (let i = 0; i < voucher.ledgerEntries.length; i++) {
                        const entry = voucher.ledgerEntries[i];
                        const entryAmount = roundAmount(entry.amount);
                        if (entry.billAllocations?.length && Math.abs(lstBillTotal[i] - entryAmount) > 0.005) {
                            return {
                                isError: true,
                                content: [{ type: 'text', text: `Bill wise allocation of ledger ${entry.ledgerName} in voucher of type ${voucher.voucherType} dated ${voucher.date} adds up to ${lstBillTotal[i]} whereas amount of the ledger entry is ${entryAmount}. Both must match` }]
                            };
                        }
                        if (entry.costCentreAllocations?.length && Math.abs(lstCostCentreTotal[i] - entryAmount) > 0.005) {
                            return {
                                isError: true,
                                content: [{ type: 'text', text: `Cost centre allocation of ledger ${entry.ledgerName} in voucher of type ${voucher.voucherType} dated ${voucher.date} adds up to ${lstCostCentreTotal[i]} whereas amount of the ledger entry is ${entryAmount}. Both must match` }]
                            };
                        }
                    }
                }
                // validate master names referred by the vouchers, so that Tally does not
                // end up importing a part of the batch and rejecting the rest of it
                const lstLedgerName = await resolveMasterNames('Ledger', args.vouchers.flatMap((voucher) => [
                    voucher.partyLedgerName,
                    ...voucher.ledgerEntries.map((entry) => entry.ledgerName),
                    ...(voucher.inventoryEntries || []).map((item) => item.accountingLedger)
                ]), company);
                const lstVoucherTypeName = await resolveMasterNames('VoucherType', args.vouchers.map((voucher) => voucher.voucherType), company);
                const lstStockItemName = await resolveMasterNames('StockItem', args.vouchers.flatMap((voucher) => [
                    ...(voucher.inventoryEntries || []),
                    ...(voucher.sourceEntries || []),
                    ...(voucher.destinationEntries || [])
                ].map((item) => item.stockItemName)), company);
                // every inventory line is normalised the same way, whichever list it belongs to
                const mapInventoryEntry = (item) => ({
                    stockItemName: lstStockItemName.get(item.stockItemName),
                    quantity: Math.abs(item.quantity),
                    rate: item.rate,
                    unit: item.unit,
                    amount: roundAmount(item.amount),
                    godownName: item.godownName,
                    batchName: item.batchName,
                    accountingLedger: item.accountingLedger ? lstLedgerName.get(item.accountingLedger) : undefined
                });
                let lstObjVoucher = [];
                for (const voucher of args.vouchers) {
                    const lstLedgerEntry = voucher.ledgerEntries.map((entry) => ({
                        ledgerName: lstLedgerName.get(entry.ledgerName),
                        amount: roundAmount(entry.amount),
                        billAllocations: (entry.billAllocations || []).map((bill) => ({
                            name: bill.name,
                            billType: bill.billType,
                            amount: roundAmount(bill.amount),
                            creditPeriod: bill.creditPeriod
                        })),
                        costCentreAllocations: (entry.costCentreAllocations || []).map((allocation) => ({
                            costCategory: allocation.costCategory || 'Primary Cost Category',
                            costCentre: allocation.costCentre,
                            amount: roundAmount(allocation.amount)
                        }))
                    }));
                    const lstInventoryEntry = (voucher.inventoryEntries || []).map(mapInventoryEntry);
                    const lstSourceEntry = (voucher.sourceEntries || []).map(mapInventoryEntry);
                    const lstDestinationEntry = (voucher.destinationEntries || []).map(mapInventoryEntry);
                    let objectView = voucher.objectView;
                    if (!objectView) {
                        if (lstSourceEntry.length > 0 || lstDestinationEntry.length > 0)
                            objectView = 'Consumption Voucher View';
                        else if (lstInventoryEntry.length > 0)
                            objectView = lstLedgerEntry.length > 0 ? 'Invoice Voucher View' : 'Inventory Voucher View';
                        else
                            objectView = 'Accounting Voucher View';
                    }
                    lstObjVoucher.push({
                        guid: voucher.guid,
                        date: parseInputDate(voucher.date),
                        voucherType: lstVoucherTypeName.get(voucher.voucherType),
                        voucherNumber: voucher.voucherNumber,
                        reference: voucher.reference,
                        referenceDate: voucher.referenceDate ? parseInputDate(voucher.referenceDate) : undefined,
                        partyLedgerName: voucher.partyLedgerName ? lstLedgerName.get(voucher.partyLedgerName) : undefined,
                        narration: voucher.narration,
                        isInvoice: objectView === 'Invoice Voucher View',
                        objectView,
                        ledgerEntries: lstLedgerEntry,
                        inventoryEntries: lstInventoryEntry,
                        sourceEntries: lstSourceEntry,
                        destinationEntries: lstDestinationEntry
                    });
                }
                let result = await importVouchers(lstObjVoucher, company);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('voucher-delete', {
            title: 'Delete Voucher',
            description: `deletes vouchers (transactions) from Tally Prime permanently and returns count of deleted records. every voucher is identified by its guid, which along with date, voucher type and voucher number can be picked from the output of ledger-account tool. this operation cannot be undone, so confirm with the user before calling this tool. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                vouchers: z.array(z.object({
                    guid: z.string().describe('guid of the voucher to delete, obtained from ledger-account tool'),
                    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('date of the voucher to delete'),
                    voucherType: z.string().describe('voucher type name of the voucher to delete'),
                    voucherNumber: z.string().optional().describe('optional voucher number of the voucher to delete')
                })).min(1).describe('array of vouchers to delete')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const lstVoucherTypeName = await resolveMasterNames('VoucherType', args.vouchers.map((voucher) => voucher.voucherType), company);
                const lstObjVoucher = args.vouchers.map((voucher) => ({
                    guid: voucher.guid,
                    date: parseInputDate(voucher.date),
                    voucherType: lstVoucherTypeName.get(voucher.voucherType),
                    voucherNumber: voucher.voucherNumber
                }));
                let result = await deleteVouchers(lstObjVoucher, company);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('company-create-update', {
            title: 'Create or Update Company',
            description: `creates a new company in Tally Prime or updates details of an existing one, returns count of created and / or altered records. note that company creation over the XML interface is dependent on the Tally Prime edition and its security settings, so if this is rejected the company has to be created from the Tally screen (Company > Create) and can then be updated by this tool`,
            inputSchema: {
                masters: z.array(z.object({
                    name: z.string().describe('company name, or the new name when renaming an existing company'),
                    _name: z.string().optional().describe('existing company name to modify / rename, validate it using list-master tool with collection as company'),
                    mailingName: z.string().optional().describe('optional name of the company for mailing and printing purpose, defaults to the company name'),
                    address: z.array(z.string()).optional().describe('optional address of the company as an array of address lines'),
                    country: z.string().describe('country of the company, validate it using query-option-values tool with input optionName as country-state'),
                    state: z.string().describe('state of the company, validate it using query-option-values tool with input optionName as country-state'),
                    pincode: z.string().optional().describe('optional pincode or ZIP code of the company'),
                    phoneNumber: z.string().optional().describe('optional contact number of the company'),
                    email: z.string().optional().describe('optional email address of the company'),
                    booksFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('date from which books of accounts begin, which also becomes the financial year start of the company'),
                    isInventory: z.boolean().optional().describe('optional, true to maintain accounts along with inventory, default is false which maintains accounts only'),
                    currencySymbol: z.string().optional().describe('optional base currency symbol of the company like Rs'),
                    currencyFormalName: z.string().optional().describe('optional formal name of the base currency like INR, mandatory when currencySymbol is specified'),
                    gstin: z.string().optional().describe('optional GSTIN or GST number of the company'),
                    incomeTaxNumber: z.string().optional().describe('optional PAN or income tax number of the company')
                })).min(1).describe('array of company objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const objIncompleteCurrency = args.masters.find((master) => master.currencySymbol && !master.currencyFormalName);
                if (objIncompleteCurrency) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Company ${objIncompleteCurrency.name} specifies currencySymbol, so currencyFormalName is mandatory` }]
                    };
                }
                let lstObjMasters = args.masters.map((master) => ({
                    ...master,
                    booksFrom: parseInputDate(master.booksFrom)
                }));
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Company', lstObjMasters, undefined));
                let result = await importMasters('master-company', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify(result) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('stock-category-create-update', {
            title: 'Create or Update Stock Category',
            description: `create or update stock category, which is a parallel classification of stock items cutting across stock groups, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('stock category name, or the new name when renaming an existing stock category'),
                    _name: z.string().optional().describe('existing stock category name to modify / rename, validate it using list-master tool with collection as stockcategory'),
                    parent: z.string().optional().describe('parent stock category name under which this category is nested. skip it to create a primary stock category')
                })).min(1).describe('array of stock category objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('StockCategory', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-stock-category', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('voucher-type-create-update', {
            title: 'Create or Update Voucher Type',
            description: `create or update a voucher type in Tally Prime, which is always derived from one of the predefined voucher types like Sales, Purchase, Payment, Receipt, Journal, Contra, Stock Journal, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('voucher type name, or the new name when renaming an existing voucher type'),
                    _name: z.string().optional().describe('existing voucher type name to modify / rename, validate it using list-master tool with collection as vouchertype'),
                    parent: z.string().describe('predefined voucher type from which this voucher type is derived like Sales, Purchase, Payment, Receipt, Contra, Journal, Credit Note, Debit Note, Delivery Note, Receipt Note, Stock Journal, Physical Stock. validate it using list-master tool with collection as vouchertype'),
                    numberingMethod: z.enum(lstNumberingMethod).optional().describe('optional method of numbering vouchers of this type, default is Automatic'),
                    isOptional: z.boolean().optional().describe('optional, true to make vouchers of this type optional by default so that they do not affect books'),
                    affectsStock: z.boolean().optional().describe('optional, true if vouchers of this type affect inventory'),
                    preventDuplicates: z.boolean().optional().describe('optional, true to stop Tally from accepting a duplicate voucher number'),
                    useCommonNarration: z.boolean().optional().describe('optional, true to allow a narration for the whole voucher'),
                    narrationsAtLineLevel: z.boolean().optional().describe('optional, true to allow a narration for every ledger line of the voucher'),
                    printAfterSave: z.boolean().optional().describe('optional, true to print the voucher immediately after saving'),
                    prefix: z.string().optional().describe('optional prefix applied to the voucher number like INV/, applicable when numberingMethod is Automatic')
                })).min(1).describe('array of voucher type objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                // the parent has to be one of the voucher types Tally already knows about
                const lstParentName = await resolveMasterNames('VoucherType', args.masters.map((master) => master.parent), company);
                const isPrefixUsed = args.masters.some((master) => master.prefix !== undefined);
                const booksBeginFrom = isPrefixUsed ? await resolveBooksBeginFrom(company) : undefined;
                let lstObjMasters = args.masters.map((master) => {
                    let objVoucherType = { ...master, parent: lstParentName.get(master.parent) };
                    if (master.prefix !== undefined) {
                        objVoucherType.prefixDetails = { applicableFrom: booksBeginFrom, prefix: master.prefix };
                    }
                    return objVoucherType;
                });
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('VoucherType', lstObjMasters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-voucher-type', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('currency-create-update', {
            title: 'Create or Update Currency',
            description: `create or update a currency in Tally Prime, used for recording transactions in a foreign currency, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('symbol of the currency like $ or Rs, this is the identity of a currency in Tally'),
                    _name: z.string().optional().describe('existing currency symbol to modify / rename, validate it using list-master tool with collection as currency'),
                    formalName: z.string().optional().describe('optional formal name of the currency like US Dollar for symbol $'),
                    expandedSymbol: z.string().optional().describe('optional symbol in words used while printing amount in words like Dollars'),
                    decimalSymbol: z.string().optional().describe('optional name of the decimal portion like Cents or Paise'),
                    decimalPlaces: z.number().int().min(0).max(4).optional().describe('optional number of decimal places, default is 2'),
                    isSymbolSuffixed: z.boolean().optional().describe('optional, true to print the symbol after the amount instead of before it'),
                    hasSpaceBetweenAmount: z.boolean().optional().describe('optional, true to leave a space between the symbol and the amount'),
                    showInMillions: z.boolean().optional().describe('optional, true to show amounts in millions instead of lakhs / crores')
                })).min(1).describe('array of currency objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Currency', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-currency', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('gst-classification-create-update', {
            title: 'Create or Update GST Classification',
            description: `create or update a GST classification, which is a reusable set of HSN / SAC and GST rate details that can be applied on many stock items and ledgers at once, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('name of the GST classification, or the new name when renaming an existing one'),
                    _name: z.string().optional().describe('existing GST classification name to modify / rename, validate it using list-master tool with collection as gstclassification'),
                    hsnCode: z.string().optional().describe('optional HSN code for goods or SAC code for services'),
                    hsnDescription: z.string().optional().describe('optional description of the HSN or SAC code'),
                    typeOfSupply: z.enum(['Goods', 'Services']).optional().describe('GST type of supply, default is Goods'),
                    taxability: z.enum(['Taxable', 'Exempt', 'Nil Rated']).optional().describe('GST taxability, default is Taxable'),
                    rate: z.number().min(0).max(100).describe('total GST rate in percentage, which is split internally as half into CGST and half into SGST and full into IGST')
                })).min(1).describe('array of GST classification objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                // GST details are applicable from a date, for which Tally expects books begin date
                const booksBeginFrom = await resolveBooksBeginFrom(company);
                let lstObjMasters = args.masters.map((master) => ({
                    name: master.name,
                    _name: master._name,
                    applicableFrom: booksBeginFrom,
                    hsnCode: master.hsnCode,
                    hsnDescription: master.hsnDescription || master.hsnCode,
                    typeOfSupply: master.typeOfSupply || 'Goods',
                    taxability: master.taxability || 'Taxable',
                    cgstRate: master.rate / 2,
                    sgstRate: master.rate / 2,
                    igstRate: master.rate
                }));
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('GSTClassification', lstObjMasters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-gst-classification', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('budget-create-update', {
            title: 'Create or Update Budget',
            description: `create or update a budget in Tally Prime for a period, with closing balance targets against groups, ledgers and cost centres. amount convention is debit is negative and credit is positive, so an expense budget is a negative amount. returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('budget name, or the new name when renaming an existing budget'),
                    _name: z.string().optional().describe('existing budget name to modify / rename, validate it using list-master tool with collection as budget'),
                    parent: z.string().optional().describe('optional parent budget name under which this budget is nested'),
                    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('start date of the budget period'),
                    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('end date of the budget period'),
                    groupBudgets: z.array(z.object({
                        name: z.string().describe('group name, validate it using list-master tool with collection as group'),
                        amount: z.number().describe('closing balance budgeted for the group, debit is negative and credit is positive'),
                        isNettBalance: z.boolean().optional().describe('optional, true to nett debit and credit balances of the group while comparing against the budget')
                    })).optional().describe('optional budget targets against groups'),
                    ledgerBudgets: z.array(z.object({
                        name: z.string().describe('ledger name, validate it using list-master tool with collection as ledger'),
                        amount: z.number().describe('closing balance budgeted for the ledger, debit is negative and credit is positive')
                    })).optional().describe('optional budget targets against ledgers'),
                    costCentreBudgets: z.array(z.object({
                        name: z.string().describe('cost centre name, validate it using list-master tool with collection as costcentre'),
                        amount: z.number().describe('closing balance budgeted for the cost centre, debit is negative and credit is positive')
                    })).optional().describe('optional budget targets against cost centres')
                })).min(1).describe('array of budget objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const objEmptyBudget = args.masters.find((master) => !master.groupBudgets?.length && !master.ledgerBudgets?.length && !master.costCentreBudgets?.length);
                if (objEmptyBudget) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Budget ${objEmptyBudget.name} carries no target. Specify at least one of groupBudgets, ledgerBudgets or costCentreBudgets` }]
                    };
                }
                // referenced masters are validated upfront, since Tally rejects the whole budget otherwise
                const lstGroupName = await resolveMasterNames('Group', args.masters.flatMap((master) => (master.groupBudgets || []).map((item) => item.name)), company);
                const lstLedgerName = await resolveMasterNames('Ledger', args.masters.flatMap((master) => (master.ledgerBudgets || []).map((item) => item.name)), company);
                const lstCostCentreName = await resolveMasterNames('CostCentre', args.masters.flatMap((master) => (master.costCentreBudgets || []).map((item) => item.name)), company);
                let lstObjMasters = args.masters.map((master) => ({
                    name: master.name,
                    _name: master._name,
                    parent: master.parent,
                    fromDate: parseInputDate(master.fromDate),
                    toDate: parseInputDate(master.toDate),
                    groupBudgets: (master.groupBudgets || []).map((item) => ({ name: lstGroupName.get(item.name), amount: roundAmount(item.amount), isNettBalance: item.isNettBalance })),
                    ledgerBudgets: (master.ledgerBudgets || []).map((item) => ({ name: lstLedgerName.get(item.name), amount: roundAmount(item.amount) })),
                    costCentreBudgets: (master.costCentreBudgets || []).map((item) => ({ name: lstCostCentreName.get(item.name), amount: roundAmount(item.amount) }))
                }));
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Budget', lstObjMasters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-budget', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('pay-head-create-update', {
            title: 'Create or Update Pay Head',
            description: `create or update a payroll pay head in Tally Prime, which is the earning, deduction or contribution component used while processing salary. a pay head is internally a ledger, so it also appears in list-master with collection as ledger. returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('pay head name, or the new name when renaming an existing pay head'),
                    _name: z.string().optional().describe('existing pay head name to modify / rename, validate it using list-master tool with collection as ledger'),
                    parent: z.string().describe('group under which the pay head is nested, typically Indirect Expenses for earnings and Current Liabilities for deductions. validate it using list-master tool with collection as group'),
                    payHeadType: z.enum(lstPayHeadType).describe('nature of the pay head'),
                    isDebit: z.boolean().describe('true if the pay head is a debit or expense to the company (typical for earnings), false if it is a credit or liability (typical for deductions)'),
                    payslipName: z.string().optional().describe('optional name to be printed on the payslip, defaults to the pay head name'),
                    calculationType: z.enum(lstCalculationType).optional().describe('optional method by which the pay head amount is computed'),
                    calculationPeriod: z.enum(['Days', 'Weeks', 'Months', 'Fortnights']).optional().describe('optional period over which the pay head is calculated, applicable when calculationType is On Attendance'),
                    attendanceType: z.string().optional().describe('optional attendance or production type on which the pay head is calculated, applicable when calculationType is On Attendance or On Production. validate it using list-master tool with collection as attendancetype'),
                    appropriateFor: z.string().optional().describe('optional statutory pay type this pay head is appropriated for like Salary'),
                    roundingMethod: z.enum(lstRoundingMethod).optional().describe('optional rounding applied on the computed amount'),
                    roundingLimit: z.number().int().min(0).optional().describe('optional rounding limit, applicable when roundingMethod is other than Not Applicable, default is 1'),
                    isBillWise: z.boolean().optional().describe('optional, true to maintain bill wise details on the pay head, typically used for loans and advances')
                })).min(1).describe('array of pay head objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const lstParentName = await resolveMasterNames('Group', args.masters.map((master) => master.parent), company);
                let lstObjMasters = args.masters.map((master) => ({
                    ...master,
                    parent: lstParentName.get(master.parent),
                    roundingLimit: master.roundingLimit === undefined ? 1 : master.roundingLimit
                }));
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Ledger', lstObjMasters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-pay-head', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('employee-create-update', {
            title: 'Create or Update Employee',
            description: `create or update a payroll employee or employee group in Tally Prime. Tally stores an employee as a cost centre flagged for payroll, so employees also appear in list-master with collection as costcentre. returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('employee or employee group name, or the new name when renaming an existing one'),
                    _name: z.string().optional().describe('existing employee name to modify / rename, validate it using list-master tool with collection as employee'),
                    isGroup: z.boolean().optional().describe('optional, true to create an employee group instead of an employee, default is false'),
                    category: z.string().optional().describe('cost category under which the employee is nested, default is Primary Cost Category'),
                    parent: z.string().optional().describe('optional employee group under which the employee is nested, validate it using list-master tool with collection as employee'),
                    dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('date of joining of the employee, mandatory unless isGroup is true'),
                    dateOfRelease: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional date of resignation or release of the employee'),
                    employeeNumber: z.string().optional().describe('optional employee code or number'),
                    designation: z.string().optional().describe('optional designation of the employee'),
                    functionName: z.string().optional().describe('optional function or department of the employee'),
                    location: z.string().optional().describe('optional work location of the employee'),
                    gender: z.enum(['Male', 'Female', 'Other']).optional().describe('optional gender of the employee'),
                    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('optional date of birth of the employee'),
                    mobileNumber: z.string().optional().describe('optional contact number of the employee'),
                    email: z.string().optional().describe('optional email address of the employee'),
                    panNumber: z.string().optional().describe('optional PAN or income tax number of the employee'),
                    bankDetails: z.object({
                        bankName: z.string().describe('name of the bank'),
                        accountNumber: z.string().describe('bank account number of the employee'),
                        ifscCode: z.string().describe('IFSC code of the bank branch')
                    }).optional().describe('optional bank details of the employee used for salary payment')
                })).min(1).describe('array of employee objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const objMissingJoining = args.masters.find((master) => !master.isGroup && !master.dateOfJoining);
                if (objMissingJoining) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Employee ${objMissingJoining.name} is missing dateOfJoining, which Tally needs for every employee. Set isGroup to true if an employee group was intended` }]
                    };
                }
                let lstObjMasters = args.masters.map((master) => ({
                    ...master,
                    dateOfJoining: master.dateOfJoining ? parseInputDate(master.dateOfJoining) : undefined,
                    dateOfRelease: master.dateOfRelease ? parseInputDate(master.dateOfRelease) : undefined,
                    dateOfBirth: master.dateOfBirth ? parseInputDate(master.dateOfBirth) : undefined
                }));
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('Employee', lstObjMasters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-employee', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
        mcpServer.registerTool('attendance-type-create-update', {
            title: 'Create or Update Attendance Type',
            description: `create or update a payroll attendance, leave or production type in Tally Prime like Present, Absent, Overtime or Piece Production, returns count of created and / or altered records. targetCompany is MANDATORY on every call, naming one of the companies open in Tally exactly as listed by server-info; the write is applied to that company only and the response echoes it in a company property`,
            inputSchema: {
                targetCompany: targetCompanySchema,
                masters: z.array(z.object({
                    name: z.string().describe('attendance type name, or the new name when renaming an existing one'),
                    _name: z.string().optional().describe('existing attendance type name to modify / rename, validate it using list-master tool with collection as attendancetype'),
                    parent: z.string().optional().describe('optional parent attendance type under which this one is nested. skip it to create a primary attendance type'),
                    attendanceType: z.enum(lstAttendanceNature).describe('nature of the attendance type. use User Defined for a production type measured in a unit rather than in days'),
                    period: z.enum(['Days', 'Weeks', 'Months', 'Fortnights']).optional().describe('optional unit of the attendance period, default is Days. not applicable when attendanceType is User Defined'),
                    productionType: z.string().optional().describe('production type like Piece Production or Time Based Production, mandatory when attendanceType is User Defined'),
                    unit: z.string().optional().describe('unit of measurement for the production, mandatory when attendanceType is User Defined. validate it using list-master tool with collection as unit')
                })).min(1).describe('array of attendance type objects to create or update')
            },
            annotations: {
                readOnlyHint: false,
                openWorldHint: false,
                destructiveHint: true,
                idempotentHint: true
            }
        }, async (args) => {
            try {
                const company = await resolveTargetCompany(args.targetCompany);
                const objIncompleteProduction = args.masters.find((master) => master.attendanceType === 'User Defined' && !(master.productionType && master.unit));
                if (objIncompleteProduction) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Attendance type ${objIncompleteProduction.name} is User Defined, so productionType and unit are both mandatory` }]
                    };
                }
                let objMasterInput = new Map();
                objMasterInput.set('masters', await resolveMasterActions('AttendanceType', args.masters, company));
                objMasterInput.set('targetCompany', company);
                let result = await importMasters('master-attendance-type', objMasterInput);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ...result, company }) }]
                };
            }
            catch (err) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: formatError(err) }]
                };
            }
        });
    }
    return mcpServer;
}
//# sourceMappingURL=mcp.mjs.map