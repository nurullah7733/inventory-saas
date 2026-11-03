#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/05d055f9e7d9037e902082575befae52fa21a0d661b8df1ef07446a03a4fca4a/contract';
import startContract from '../../snapshots/05d055f9e7d9037e902082575befae52fa21a0d661b8df1ef07446a03a4fca4a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b9c766917292153280ec111fffc0dbdea76fc2948da775e7b443f72d8f9af778/contract';
import endContract from '../../snapshots/b9c766917292153280ec111fffc0dbdea76fc2948da775e7b443f72d8f9af778/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'tenants',
        column: col('show_logo_on_invoice', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
