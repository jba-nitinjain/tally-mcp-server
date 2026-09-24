import { parseTallyBoolean } from './tally.mjs';
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
 * null so the caller sees the gap instead of a silent false.
 * Moved out of mcp.mts so ledger-account uses the same rule to tell a nominal ledger from a real one (feedback #59)
 */
const lstProfitLossPrimaryGroup = ['sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses'];
export function resolveBsPl(isRevenue, primaryGroup) {
    if (typeof isRevenue === 'boolean')
        return isRevenue;
    const groupName = typeof primaryGroup === 'string' ? primaryGroup.trim().toLowerCase() : '';
    if (!groupName)
        return null;
    return lstProfitLossPrimaryGroup.includes(groupName);
}
/**
 * Nature of the ledger behind a ledger-account statement, read from its synthetic Closing row, which carries
 * is_revenue ($IsRevenue) and primary_group. nominal = Profit & Loss ledger (bs_pl true), real = Balance Sheet
 * ledger (bs_pl false), null = neither could be resolved
 */
export function ledgerNatureOf(closingRow) {
    if (!closingRow)
        return null;
    const bsPl = resolveBsPl(parseTallyBoolean(closingRow.is_revenue), closingRow.primary_group);
    return bsPl === null ? null : (bsPl ? 'nominal' : 'real');
}
//# sourceMappingURL=ledgernature.mjs.map