#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/48d5dde1cbaa773fe6c1d7ea4f368460df3325f38e54028f06bc2b921218d962/contract';
import startContract from '../../snapshots/48d5dde1cbaa773fe6c1d7ea4f368460df3325f38e54028f06bc2b921218d962/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e487653eb58d18fd41c16a71cfae7034be0d9a606ca7ef5a86ce451e78bbac64/contract';
import endContract from '../../snapshots/e487653eb58d18fd41c16a71cfae7034be0d9a606ca7ef5a86ce451e78bbac64/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('reset_email', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('reset_expires_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('reset_token_hash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_reset_token_hash_key',
        columns: ['reset_token_hash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
