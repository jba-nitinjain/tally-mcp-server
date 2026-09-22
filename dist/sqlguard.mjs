import { parse, astVisitor } from 'pgsql-ast-parser';
/**
 * Read-only guard for the query-database tool.
 *
 * Primary check: parse the SQL with pgsql-ast-parser and accept only when the single
 * top-level statement is a SELECT (optionally with a WITH / WITH RECURSIVE clause, UNION,
 * INTERSECT, EXCEPT or VALUES) and no statement anywhere in the tree, including CTE bodies
 * and sub-queries, is data-modifying or DDL.
 *
 * Fallback check: pgsql-ast-parser does not understand every PGlite construct (e.g. SIMILAR TO,
 * WINDOW clause, GROUPING SETS, $$ strings). When the parser cannot read the text, comments,
 * string literals and quoted identifiers are stripped and the remaining tokens must start with
 * SELECT or WITH and contain no data-modifying / transaction-control keyword as a whole word.
 *
 * Either way the error names what was refused and which check refused it. Execution itself
 * runs inside a READ ONLY transaction (see database.mts), so this guard is defence in depth
 * rather than the sole protection.
 */
const ALLOWED_STATEMENT_TYPES = new Set([
    'select', 'with', 'with recursive', 'union', 'union all', 'intersect', 'except', 'values'
]);
// node.type values of pgsql-ast-parser that modify data, schema or transaction state.
// 'call' is deliberately absent: in this AST it is a function-call expression, not the CALL statement.
const FORBIDDEN_NODE_TYPE = /^(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|set|reset|begin|commit|rollback|start|prepare|deallocate|do|refresh|comment|tablespace|raise|show|execute|lock|vacuum|reindex|cluster|listen|notify|discard|load|import)\b/i;
// Whole-word keywords refused by the text fallback. INTO covers SELECT ... INTO (creates a table).
// The fallback already requires the first keyword to be SELECT / WITH and refuses a second statement,
// so transaction-control and maintenance verbs (BEGIN, COMMIT, VACUUM, CLUSTER ...) cannot act as
// statements here and are deliberately left out: they are plausible unquoted column names.
// END is absent (CASE ... END) and FETCH is absent (FETCH FIRST n ROWS ONLY) for the same reason.
const FORBIDDEN_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'ALTER', 'DROP', 'CREATE', 'GRANT', 'REVOKE',
    'COPY', 'CALL', 'INTO'
];
const describeStatement = (type) => type.toUpperCase();
/**
 * Throws an Error naming the refused construct when the SQL is not a single read-only statement.
 * Returns silently when the statement is acceptable.
 */
export function assertReadOnlySQL(sql) {
    if (typeof sql !== 'string' || sql.trim() === '')
        throw new Error('Refused: empty SQL. Supply a single SELECT (or WITH ... SELECT) statement');
    let statements;
    try {
        statements = parse(sql, { locationTracking: true });
    }
    catch (parseErr) {
        // PGlite may accept syntax the parser does not; fall back to the keyword check
        const reason = String(parseErr?.message ?? parseErr).split('\n')[0];
        assertReadOnlyByKeywords(sql, reason);
        return;
    }
    if (statements.length === 0)
        throw new Error('Refused by SQL parser: no statement found. Supply a single SELECT (or WITH ... SELECT) statement');
    if (statements.length > 1) {
        const second = statements[1];
        throw new Error(`Refused by SQL parser: ${statements.length} statements found (second is ${describeStatement(second.type)} at position ${second._location?.start ?? '?'}). One read-only statement per call`);
    }
    const top = statements[0];
    if (!ALLOWED_STATEMENT_TYPES.has(top.type))
        throw new Error(`Refused by SQL parser: statement type ${describeStatement(top.type)} at position ${top._location?.start ?? 0}. Only SELECT, WITH ... SELECT, UNION / INTERSECT / EXCEPT and VALUES are permitted`);
    // Walk every statement reachable from the top (CTE bodies, sub-queries in FROM, set operations)
    // and refuse any that is not a select-type statement.
    const visitor = astVisitor((map) => ({
        statement: (s) => {
            if (!ALLOWED_STATEMENT_TYPES.has(s.type))
                throw new Error(`Refused by SQL parser: statement type ${describeStatement(s.type)} at position ${s._location?.start ?? '?'} inside the query (data-modifying CTEs and sub-statements are not permitted)`);
            map.super().statement(s);
        }
    }));
    visitor.statement(top);
    // Belt and braces: a generic walk over every node in the tree, in case a modifying statement
    // sits somewhere the visitor does not dispatch through `statement` (e.g. a scalar sub-query).
    walkNodes(top, (node) => {
        if (typeof node.type === 'string' && FORBIDDEN_NODE_TYPE.test(node.type))
            throw new Error(`Refused by SQL parser: ${describeStatement(node.type)} node at position ${node._location?.start ?? '?'} inside the query (only read-only SELECT constructs are permitted)`);
    });
}
function walkNodes(node, visit, seen = new Set()) {
    if (node === null || typeof node !== 'object' || seen.has(node))
        return;
    seen.add(node);
    if (Array.isArray(node)) {
        for (const item of node)
            walkNodes(item, visit, seen);
        return;
    }
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === '_location')
            continue;
        walkNodes(node[key], visit, seen);
    }
}
/**
 * Text-based fallback used only when pgsql-ast-parser cannot read the statement.
 * Strips comments, string literals and quoted identifiers, then inspects the remaining tokens.
 */
function assertReadOnlyByKeywords(sql, parseReason) {
    const because = `(SQL parser could not read the query: ${parseReason})`;
    const stripped = stripLiteralsAndComments(sql);
    // Reject more than one statement: a trailing semicolon is tolerated, anything after it is not
    const semicolon = stripped.indexOf(';');
    if (semicolon >= 0 && stripped.slice(semicolon + 1).trim() !== '')
        throw new Error(`Refused by keyword check ${because}: a second statement begins after the semicolon at position ${semicolon}. One read-only statement per call`);
    const firstMatch = /^\s*\(*\s*([A-Za-z_]+)/.exec(stripped);
    const firstKeyword = firstMatch ? firstMatch[1].toUpperCase() : '';
    if (firstKeyword !== 'SELECT' && firstKeyword !== 'WITH')
        throw new Error(`Refused by keyword check ${because}: first keyword ${firstKeyword || '(none)'} is not SELECT or WITH`);
    const forbidden = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');
    const hit = forbidden.exec(stripped);
    if (hit)
        throw new Error(`Refused by keyword check ${because}: keyword ${hit[1].toUpperCase()} at position ${hit.index} is not permitted in a read-only query. Quote it as an identifier if it is a column name`);
}
/**
 * Replaces the contents of comments, single-quoted / E'' / dollar-quoted string literals and
 * double-quoted identifiers with spaces of the same length, so positions reported afterwards
 * still line up with the original text.
 */
function stripLiteralsAndComments(sql) {
    let out = '';
    let i = 0;
    const n = sql.length;
    const blank = (from, to) => { out += ' '.repeat(to - from); };
    while (i < n) {
        const ch = sql[i];
        const next = sql[i + 1];
        if (ch === '-' && next === '-') {
            const end = sql.indexOf('\n', i);
            const stop = end < 0 ? n : end;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '/' && next === '*') {
            let depth = 1;
            let j = i + 2;
            while (j < n && depth > 0) {
                if (sql[j] === '/' && sql[j + 1] === '*') {
                    depth++;
                    j += 2;
                }
                else if (sql[j] === '*' && sql[j + 1] === '/') {
                    depth--;
                    j += 2;
                }
                else
                    j++;
            }
            blank(i, j);
            i = j;
            continue;
        }
        if (ch === "'" || ((ch === 'E' || ch === 'e') && next === "'")) {
            const escapeString = ch !== "'";
            let j = escapeString ? i + 2 : i + 1;
            while (j < n) {
                if (escapeString && sql[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (sql[j] === "'") {
                    if (sql[j + 1] === "'") {
                        j += 2;
                        continue;
                    }
                    j++;
                    break;
                }
                j++;
            }
            blank(i, Math.min(j, n));
            i = Math.min(j, n);
            continue;
        }
        if (ch === '"') {
            let j = i + 1;
            while (j < n) {
                if (sql[j] === '"') {
                    if (sql[j + 1] === '"') {
                        j += 2;
                        continue;
                    }
                    j++;
                    break;
                }
                j++;
            }
            blank(i, Math.min(j, n));
            i = Math.min(j, n);
            continue;
        }
        if (ch === '$') {
            const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (tag) {
                const close = sql.indexOf(tag[0], i + tag[0].length);
                const stop = close < 0 ? n : close + tag[0].length;
                blank(i, stop);
                i = stop;
                continue;
            }
        }
        out += ch;
        i++;
    }
    return out;
}
//# sourceMappingURL=sqlguard.mjs.map