// ---------------------------------------------------------------------------
// Transport failures of a call to Tally, kept apart from answers given by Tally (feedback #56)
//
// A report which Tally could not finish inside the budget, a socket reset, an aborted or truncated
// response and an empty body are all "Tally did not deliver", never "Tally has no rows". Up to
// v7.8.1 such a failure inside a report was swallowed and reached the caller as rowCount 0 with
// the message "Tally returned no rows". Every one of them now surfaces as code TALLY_TIMEOUT
// ---------------------------------------------------------------------------

export type TallyTransportPhase = 'queue' | 'connect' | 'response';

/** what exactly went wrong, carried next to the TALLY_TIMEOUT code */
export type TallyTimeoutReason = 'timeout' | 'connect-timeout' | 'reset' | 'aborted' | 'empty-response' | 'truncated-response';

export interface TallyPeriod {
    fromDate: string | null;
    toDate: string | null;
}

/** the error object handed to the MCP caller */
export interface TallyTimeoutDetail {
    code: 'TALLY_TIMEOUT';
    reason: TallyTimeoutReason;
    phase: TallyTransportPhase;
    elapsedMs: number;
    period: TallyPeriod | null;
    hint: 'split the period';
    message: string;
    [extra: string]: unknown;
}

/**
 * A failure of the HTTP transport to Tally as opposed to an answer from Tally. Carries the phase
 * which failed and the time spent, so the caller can tell a report Tally could not finish from a
 * connection which was never made
 */
export class TallyTransportError extends Error {
    readonly errorCode = 'TALLY_TIMEOUT' as const;
    readonly phase: TallyTransportPhase;
    /** low-level code: timeout, connect-timeout, ECONNRESET, aborted, empty-response ... */
    readonly code: string;
    readonly reason: TallyTimeoutReason;
    readonly retryable = true;
    attempts: number;
    /** time from the first attempt until the failure, filled in by the caller which owns the budget */
    elapsedMs: number;

    constructor(phase: TallyTransportPhase, code: string, attempts: number, detail: string, budgetMs?: number) {
        let reason = reasonOf(code);
        let budget = budgetMs ? ` within the ${Math.round(budgetMs / 1000)}s allowed` : '';
        let advice = phase == 'response' && (reason == 'timeout' || reason == 'truncated-response' || reason == 'empty-response')
            ? 'Tally was still working on the request, so repeating the same request is likely to time out again: split the period into shorter ranges (a month or a quarter) and ask for each one. Tally may stay busy for up to a minute finishing the abandoned request'
            : 'This is a connection condition and not a problem with the data requested: an identical retry is expected to succeed. If it keeps happening, check whether Tally Prime is showing a dialog box or is busy with another task';
        super(`Tally did not deliver a complete answer${budget} (${phase} phase, ${code}, ${attempts} attempt${attempts == 1 ? '' : 's'}). ${detail} ${advice}`);
        this.name = 'TallyTransportError';
        this.phase = phase;
        this.code = code;
        this.reason = reason;
        this.attempts = attempts;
        this.elapsedMs = 0;
    }
}

function reasonOf(code: string): TallyTimeoutReason {
    if (code == 'connect-timeout')
        return 'connect-timeout';
    if (code == 'timeout' || code == 'budget-exhausted' || code == 'ETIMEDOUT')
        return 'timeout';
    if (code == 'empty-response')
        return 'empty-response';
    if (code == 'truncated-response')
        return 'truncated-response';
    if (code == 'aborted')
        return 'aborted';
    return 'reset';
}

export function isTallyTimeout(err: unknown): err is TallyTransportError {
    return err instanceof TallyTransportError;
}

/**
 * Builds the TALLY_TIMEOUT object returned to the caller
 * @param period the period the failed request covered, when the tool has one
 * @param extra additional properties (for example the chunks of a ledger-account which did complete)
 */
export function toTimeoutDetail(err: TallyTransportError, period?: TallyPeriod | null, extra?: Record<string, unknown>): TallyTimeoutDetail {
    return {
        code: 'TALLY_TIMEOUT',
        reason: err.reason,
        phase: err.phase,
        elapsedMs: err.elapsedMs,
        period: period || null,
        hint: 'split the period',
        message: err.message,
        ...(extra || {})
    };
}
