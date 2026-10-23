/**
 * Split Purkins test migration scripts for the Miniflare D1 test adapter.
 *
 * Unlike Wrangler migration application, D1Database.exec() in this adapter
 * expects a single SQL statement. Simple semicolon splitting also breaks
 * CREATE TRIGGER ... BEGIN ...; END; in migration 0043.
 *
 * Purkins migrations use line comments and have no semicolons inside SQL
 * string literals. A trigger terminates only at an END; on its own line.
 * This deliberately small parser is test-only, not a general SQL parser.
 */
export function splitPurkinsMigrationSql(source: string): string[] {
  const cleaned = source.replace(/^\s*--[^\n]*(?:\r?\n|$)/gm, '');
  const statements: string[] = [];
  let pending = '';
  let trigger = false;

  for (const line of cleaned.split(/\r?\n/)) {
    if (!trigger && /^\s*CREATE\s+TRIGGER\b/i.test(line)) trigger = true;
    pending += line + '\n';

    if (trigger) {
      if (/^\s*END\s*;\s*$/i.test(line)) {
        const statement = pending.trim().replace(/;\s*$/, '');
        statements.push(statement);
        pending = '';
        trigger = false;
      }
      continue;
    }

    let end: number;
    while ((end = pending.indexOf(';')) >= 0) {
      const statement = pending.slice(0, end).trim();
      if (statement) statements.push(statement);
      pending = pending.slice(end + 1);
    }
  }

  if (trigger || pending.trim()) {
    throw new Error('Unterminated Purkins migration SQL statement.');
  }
  return statements;
}
