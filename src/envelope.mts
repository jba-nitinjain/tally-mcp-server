import { TallyTransportError } from './tallyerror.mjs';

// ---------------------------------------------------------------------------
// Completeness check of an answer from Tally (feedback #56)
//
// "No rows" is only a fact when Tally delivered a whole <DATA> envelope holding no <ROW>. An empty
// body, or a <DATA> envelope which never closes because the connection ended part way, means the
// answer was lost in transit, and is raised as TALLY_TIMEOUT instead of being parsed as fewer rows
// ---------------------------------------------------------------------------

/** strips a byte order mark and surrounding whitespace */
function trimBody(body: string): string {
    return (typeof body == 'string' ? body : '').replace(/^﻿/, '').trim();
}

/** true when the body holds a DATA envelope which is closed (<DATA>...</DATA> or <DATA/>) */
export function isCompleteDataEnvelope(body: string): boolean {
    let text = trimBody(body);
    if (/^<DATA\b[^>]*\/>$/i.test(text))
        return true;
    return /^<DATA\b[^>]*>[\s\S]*<\/DATA>$/i.test(text);
}

/** true when a well-formed DATA envelope carries no ROW element at all */
export function isEmptyDataEnvelope(body: string): boolean {
    return isCompleteDataEnvelope(body) && !/<ROW\b/i.test(trimBody(body));
}

/**
 * Raises TALLY_TIMEOUT when the body is not a whole answer
 * @param requireBody true for reports, where an empty body can only mean the answer was lost;
 *        collection queries pass false, since a few Tally releases answer a query matching nothing with no body
 */
export function assertCompleteEnvelope(body: string, requireBody: boolean): void {
    let text = trimBody(body);
    if (text === '') {
        if (requireBody)
            throw new TallyTransportError('response', 'empty-response', 1, 'Tally closed the connection without sending any data.');
        return;
    }
    if (/^<DATA\b/i.test(text) && !isCompleteDataEnvelope(text))
        throw new TallyTransportError('response', 'truncated-response', 1, `The answer from Tally stopped part way (${text.length} characters received, the closing </DATA> never arrived).`);
}
