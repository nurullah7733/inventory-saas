#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5124a86dd5a151c66ac58686cce3bf7936f661d629a38a6f9350a3bf4f6c2f8f/contract';
import endContract from '../../snapshots/5124a86dd5a151c66ac58686cce3bf7936f661d629a38a6f9350a3bf4f6c2f8f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6eb2d706db788ac2f2737dfbb79a48e4938eebae3adb498003d49eaf21376330/contract';
import startContract from '../../snapshots/6eb2d706db788ac2f2737dfbb79a48e4938eebae3adb498003d49eaf21376330/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('discount_percentage', 'numeric(5,2)', {
          codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 5, scale: 2 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
