// ---------------------------------------------------------------------------
// Assembly and reconciliation of a ledger-account statement, moved out of mcp.mts (feedback #56)
// ---------------------------------------------------------------------------
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
export function assembleLedgerAccount(lstRow) {
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
//# sourceMappingURL=ledgerstatement.mjs.map