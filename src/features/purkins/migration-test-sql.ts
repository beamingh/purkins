/**
 * Split Purkins migration scripts into executable D1 test statements.
 *
 * Miniflare D1's exec()/prepare() are single-statement interfaces. Naively
 * splitting on every semicolon breaks CREATE TRIGGER ... BEGIN ...; END;.
 *
 * This helper is intentionally scoped to our checked-in migration syntax:
 * standalone SQL statements, full-line '--' comments and triggers whose
 * closing END; is on its own line. Not a general-purpose SQL parser.
 */
export function splitPurkinsMigrationSql(source: string): string[] {
  const statements: string[] = [];
  let pending = '';
  let inTrigger = false;

  for (const line of source.split(/\r?\n/)) {
    // Do not match \s* across lines while stripping comments: doing so can
    // join an index and the next CREATE TRIGGER into the same line.
    if (/^\s*--/.test(line)) continue;

    if (!inTrigger && !pending.trim() && /^\s*CREATE\s+TRIGGER\b/i.test(line)) {
      inTrigger = true;
    }
    pending += line + '\n';

    if (inTrigger) {
      if (/^\s*END\s*;\s*$/i.test(line)) {
        // SQLite requires the final semicolon in a CREATE TRIGGER statement.
        statements.push(pending.trim());
        pending = '';
        inTrigger = false;
      }
      continue;
    }

    let separator: number;
    while ((separator = pending.indexOf(';')) !== -1) {
      const statement = pending.slice(0, separator).trim();
      if (statement) statements.push(statement);
      pending = pending.slice(separator + 1);
    }
  }

  if (inTrigger || pending.trim()) {
    throw new Error('Unterminated Purkins migration SQL statement.');
  }
  return statements;
}
