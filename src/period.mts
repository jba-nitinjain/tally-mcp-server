// ---------------------------------------------------------------------------
// Date-range helpers for splitting a long report period into calendar months (feedback #56).
// Dates travel as ISO strings (YYYY-MM-DD) and are computed in UTC, so no timezone can move a
// boundary by a day; they are shown to people as dd/mm/yyyy
// ---------------------------------------------------------------------------

export interface PeriodRange {
    fromDate: string;
    toDate: string;
}

function parseIso(value: string): Date {
    let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    if (!match)
        throw new Error(`Invalid date [${value}], expected YYYY-MM-DD`);
    return new Date(Date.UTC(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3])));
}

function toIso(date: Date): string {
    return date.toISOString().substring(0, 10);
}

/** adds whole months, clamping the day to the end of a shorter month (30 Nov + 3 months = 28 Feb) */
export function addMonths(value: string, months: number): string {
    let date = parseIso(value);
    let target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
    let lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return toIso(target);
}

function addDays(value: string, days: number): string {
    let date = parseIso(value);
    date.setUTCDate(date.getUTCDate() + days);
    return toIso(date);
}

function endOfMonth(value: string): string {
    let date = parseIso(value);
    return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/** true when the inclusive range from..to is longer than the given number of months (01/04 to 30/06 is exactly 3) */
export function isLongerThanMonths(fromDate: string, toDate: string, months: number): boolean {
    return toDate >= addMonths(fromDate, months);
}

/** splits from..to into calendar-month ranges; the first and last may be part months */
export function splitByMonth(fromDate: string, toDate: string): PeriodRange[] {
    let retval: PeriodRange[] = [];
    let start = fromDate;
    while (start <= toDate) {
        let monthEnd = endOfMonth(start);
        let end = monthEnd < toDate ? monthEnd : toDate;
        retval.push({ fromDate: start, toDate: end });
        start = addDays(end, 1);
    }
    return retval;
}

/** groups consecutive ranges into runs of at most `size` ranges, merged into one range each */
export function groupRanges(lstRange: PeriodRange[], size: number): PeriodRange[] {
    let retval: PeriodRange[] = [];
    for (let i = 0; i < lstRange.length; i += size) {
        let group = lstRange.slice(i, i + size);
        retval.push({ fromDate: group[0].fromDate, toDate: group[group.length - 1].toDate });
    }
    return retval;
}

/** dd/mm/yyyy for messages read by people */
export function displayDate(value: string): string {
    let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}
