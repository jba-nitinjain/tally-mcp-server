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
}

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