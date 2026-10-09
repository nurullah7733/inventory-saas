#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/67f9d5cf657bf732c84c7c5cfbc348c3b50137d5a172a186ccadacabba12cda9/contract';
import endContract from '../../snapshots/67f9d5cf657bf732c84c7c5cfbc348c3b50137d5a172a186ccadacabba12cda9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9759b50c479435158ecb0e4838c8d7712caeb8aceece2d0e77665d958b369d9d/contract';
import startContract from '../../snapshots/9759b50c479435158ecb0e4838c8d7712caeb8aceece2d0e77665d958b369d9d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('photo_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
