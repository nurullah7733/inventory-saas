#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/755c42db8f08439e5f7fa803b5d54170d08e2542a13a658fafca7d417bae2e62/contract';
import startContract from '../../snapshots/755c42db8f08439e5f7fa803b5d54170d08e2542a13a658fafca7d417bae2e62/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7c70a2e5af82a02526b86c46422200810d5e4500661d2827d1e6e437d4b88db5/contract';
import endContract from '../../snapshots/7c70a2e5af82a02526b86c46422200810d5e4500661d2827d1e6e437d4b88db5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'subscriptions',
        column: col('duration_months', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
