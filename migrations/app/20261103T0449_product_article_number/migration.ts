#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7c70a2e5af82a02526b86c46422200810d5e4500661d2827d1e6e437d4b88db5/contract';
import startContract from '../../snapshots/7c70a2e5af82a02526b86c46422200810d5e4500661d2827d1e6e437d4b88db5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/93e797b53394cc25595a20aa1c5050ad5c752ecd1d653565f3d4bf9a1623b962/contract';
import endContract from '../../snapshots/93e797b53394cc25595a20aa1c5050ad5c752ecd1d653565f3d4bf9a1623b962/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'products',
        column: col('article_number', 'SERIAL', {
          notNull: true,
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'products',
        constraint: 'products_article_number_key',
        columns: ['article_number'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
