#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/334c80fa7b5c8248eaa7db4bed7ccf2ca12cb6d2abf3a8a77178e5514286aee2/contract';
import startContract from '../../snapshots/334c80fa7b5c8248eaa7db4bed7ccf2ca12cb6d2abf3a8a77178e5514286aee2/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9759b50c479435158ecb0e4838c8d7712caeb8aceece2d0e77665d958b369d9d/contract';
import endContract from '../../snapshots/9759b50c479435158ecb0e4838c8d7712caeb8aceece2d0e77665d958b369d9d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_type_check_21048d23',
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('source_movement_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_type_check_226c0006',
        expression:
          "\"type\" IN ('in', 'out', 'adjustment', 'return', 'purchase_return', 'wastage')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_purchase_return_check_d16ddb80',
        expression:
          "(type = 'purchase_return' AND source_movement_id IS NOT NULL AND source_movement_id <> id AND supplier_id IS NOT NULL AND unit_cost IS NOT NULL AND quantity < 0) OR (type <> 'purchase_return' AND source_movement_id IS NULL)",
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_source_movement_id_idx_83e9f6f3',
        columns: ['source_movement_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_source_tenant_idx_154068f0',
        columns: ['tenant_id', 'source_movement_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_source_movement_id_fkey',
          columns: ['source_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
