export interface ModelPullReportOutputFieldInfo {
    name: string;
    datatype: string;
}

export interface ModelPullReportInputInfo {
    name: string;
    datatype: string;
    validation_regex?: string;
    validation_message?: string;
}

export interface ModelPullResponse {
    data: any | undefined;
    error?: string;
    /** set when Tally did not deliver a complete answer (code TALLY_TIMEOUT); error then carries it as JSON */
    errorDetail?: import('./tallyerror.mjs').TallyTimeoutDetail;
}

export interface ModelPullReportInfo {
    name: string;
    input: ModelPullReportInputInfo[];
    output: ModelPullReportOutputFieldInfo[];
}

export interface TallyStaticVariable {
    name: string;
    value: string;
}

export interface TallyFieldDefinition {
    name: string;
    datatype: string;
    expression?: string;
    description?: string;
}

export interface TallyFilterDefinition {
    name: string;
    expression: string;
}

export interface TallyCollectionDefinition {
    collection: string;
    description?: string;
    fields: TallyFieldDefinition[];
    tallyType?: string; //object type Tally actually stores the records under, when it differs from the collection name
    tallyFilter?: string; //TDL condition picking this collection's records out of tallyType
}

export interface TallyActionVariableDefinition {
    name: string;
    value: string;
}

export interface TallyActionDefinition {
    targetReport: string;
    variables: TallyActionVariableDefinition[];
}

export interface CreateUpdateDeleteStatus {
    created?: number;
    altered?: number;
    deleted?: number;
    combined?: number;
    ignored?: number;
    cancelled?: number;
    errors?: number;
    exceptions?: number;
    lastVoucherId?: number; //master id of the last voucher Tally created in the request (LASTVCHID), present only when one was created
}

export interface TallyVoucherIdentity {
    guid: string;
    /** stored remote GUID (REMOTEGUID), set when the voucher was imported with a REMOTEID other than its GUID */
    remoteGuid?: string;
    /** the id Tally matches an import's REMOTEID against: remoteGuid when non-empty, else guid */
    remoteId?: string;
    masterId: number;
    date: Date;
    voucherType: string;
    voucherNumber: string;
    /** ALTERID, raised by Tally on every change of the voucher */
    alterId?: number;
}

/** how an import tells Tally which existing voucher to alter or delete: by date, type and number (works for every voucher), or by the id another program stored with it */
export type TallyImportTarget =
    | { kind: 'number'; date: Date; voucherType: string; voucherNumber: string }
    | { kind: 'remoteId'; remoteId: string; voucherType: string };

export interface TallyVoucherLedgerEntry {
    ledgerName: string;
    amount: number;
    billAllocations?: any[];
    costCentreAllocations?: any[];
}

export interface TallyVoucherInventoryEntry {
    stockItemName: string;
    quantity: number;
    amount: number;
    rate?: number;
    unit?: string;
    godownName?: string;
    batchName?: string;
    accountingLedger?: string;
}

export interface TallyVoucher {
    guid?: string;
    date: Date;
    voucherType: string;
    voucherNumber?: string;
    reference?: string;
    referenceDate?: Date;
    partyLedgerName?: string;
    narration?: string;
    isInvoice?: boolean;
    objectView: string;
    ledgerEntries: TallyVoucherLedgerEntry[];
    inventoryEntries?: TallyVoucherInventoryEntry[];
}