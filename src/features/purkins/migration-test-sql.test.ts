import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitPurkinsMigrationSql } from './migration-test-sql';

const migration = (name: string): string =>
  readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');

describe('Purkins test migration SQL segmentation', () => {
  it('splits ordinary D1 statements instead of passing entire scripts to exec()', () => {
    expect(splitPurkinsMigrationSql(migration('0040_purkins_intake.sql'))).toHaveLength(3);
    expect(splitPurkinsMigrationSql(migration('0041_purkins_cataloguing.sql'))).toHaveLength(9);
    expect(splitPurkinsMigrationSql(migration('0042_purkins_manual_pricing.sql'))).toHaveLength(1);
  });

  it('keeps the full 0043 ancestry-cycle trigger in one executable statement', () => {
    const statements = splitPurkinsMigrationSql(migration('0043_purkins_location_tree.sql'));
    expect(statements).toHaveLength(8);
    const trigger = statements.filter((sql) => sql.startsWith('CREATE TRIGGER'));
    expect(trigger).toHaveLength(1);
    expect(trigger[0]).toContain('SELECT RAISE(ABORT');
    expect(trigger[0]).toContain('END');
    expect(trigger[0]).toContain('   );');
    expect(statements.at(-1)).toMatch(/^UPDATE purkins_intake/);
  });

  it('rejects unterminated migration statements instead of silently skipping them', () => {
    expect(() => splitPurkinsMigrationSql('CREATE TABLE broken (id INT')).toThrow(/Unterminated/);
    expect(() => splitPurkinsMigrationSql('CREATE TRIGGER test BEFORE UPDATE ON foo BEGIN'))
      .toThrow(/Unterminated/);
  });
});
