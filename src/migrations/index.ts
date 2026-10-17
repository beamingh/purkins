import * as migration_20261017_114253_purkins_initial from './20261017_114253_purkins_initial';

export const migrations = [
  {
    up: migration_20261017_114253_purkins_initial.up,
    down: migration_20261017_114253_purkins_initial.down,
    name: '20261017_114253_purkins_initial'
  },
];
