#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1d881a839b5f90e6a79f87fff477b7275be59769550f1acf1ea97adab9aaa424/contract';
import endContract from '../../snapshots/1d881a839b5f90e6a79f87fff477b7275be59769550f1acf1ea97adab9aaa424/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c2f37152cb0f3f65a4b7966010f32ae496a3851665bf6fca107131b5673efc66/contract';
import startContract from '../../snapshots/c2f37152cb0f3f65a4b7966010f32ae496a3851665bf6fca107131b5673efc66/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropDefault({ schema: 'public', table: 'product_variants', column: 'stock_qty' }),
      this.dropDefault({ schema: 'public', table: 'products', column: 'stock_qty' }),
      this.addColumn({
        schema: 'public',
        table: 'variant_units',
        column: col('measured', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      rawSql({
        id: 'data.backfill_measured_units',
        label: 'Mark obvious measured units (kg, g, l, ml, liter, litre, ton) as measured',
        operationClass: 'data',
        target: {
          id: 'data.backfill_measured_units',
          details: { schema: 'public', objectType: 'table', name: 'variant_units' },
        },
        precheck: [],
        execute: [
          {
            description: 'Set measured = true for continuous units of measure',
            sql: `UPDATE "public"."variant_units"
SET "measured" = true
WHERE lower("name") IN ('kg', 'g', 'l', 'ml', 'liter', 'litre', 'ton')`,
          },
        ],
        postcheck: [],
      }),
      // int → numeric(12,3) casts every existing value exactly (1 → 1.000);
      // ALTER COLUMN TYPE does the rewrite itself, so the data transforms the
      // planner insists on are documented no-ops.
      rawSql({
        id: 'data.typechange.product_variants.stock_qty',
        label: 'No row rewrite needed: int → numeric(12,3) is lossless',
        operationClass: 'data',
        target: {
          id: 'data.typechange.product_variants.stock_qty',
          details: { schema: 'public', objectType: 'table', name: 'product_variants' },
        },
        precheck: [],
        execute: [{ description: 'no-op', sql: 'SELECT 1 WHERE FALSE' }],
        postcheck: [],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'product_variants',
        column: 'stock_qty',
        options: {
          qualifiedTargetType: 'numeric(12,3)',
          formatTypeExpected: 'numeric(12,3)',
          rawTargetTypeForLabel: 'numeric(12,3)',
        },
      }),
      rawSql({
        id: 'data.typechange.products.stock_qty',
        label: 'No row rewrite needed: int → numeric(12,3) is lossless',
        operationClass: 'data',
        target: {
          id: 'data.typechange.products.stock_qty',
          details: { schema: 'public', objectType: 'table', name: 'products' },
        },
        precheck: [],
        execute: [{ description: 'no-op', sql: 'SELECT 1 WHERE FALSE' }],
        postcheck: [],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'products',
        column: 'stock_qty',
        options: {
          qualifiedTargetType: 'numeric(12,3)',
          formatTypeExpected: 'numeric(12,3)',
          rawTargetTypeForLabel: 'numeric(12,3)',
        },
      }),
      rawSql({
        id: 'data.typechange.returns.quantity',
        label: 'No row rewrite needed: int → numeric(12,3) is lossless',
        operationClass: 'data',
        target: {
          id: 'data.typechange.returns.quantity',
          details: { schema: 'public', objectType: 'table', name: 'returns' },
        },
        precheck: [],
        execute: [{ description: 'no-op', sql: 'SELECT 1 WHERE FALSE' }],
        postcheck: [],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'returns',
        column: 'quantity',
        options: {
          qualifiedTargetType: 'numeric(12,3)',
          formatTypeExpected: 'numeric(12,3)',
          rawTargetTypeForLabel: 'numeric(12,3)',
        },
      }),
      rawSql({
        id: 'data.typechange.sale_items.quantity',
        label: 'No row rewrite needed: int → numeric(12,3) is lossless',
        operationClass: 'data',
        target: {
          id: 'data.typechange.sale_items.quantity',
          details: { schema: 'public', objectType: 'table', name: 'sale_items' },
        },
        precheck: [],
        execute: [{ description: 'no-op', sql: 'SELECT 1 WHERE FALSE' }],
        postcheck: [],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'sale_items',
        column: 'quantity',
        options: {
          qualifiedTargetType: 'numeric(12,3)',
          formatTypeExpected: 'numeric(12,3)',
          rawTargetTypeForLabel: 'numeric(12,3)',
        },
      }),
      rawSql({
        id: 'data.typechange.stock_movements.quantity',
        label: 'No row rewrite needed: int → numeric(12,3) is lossless',
        operationClass: 'data',
        target: {
          id: 'data.typechange.stock_movements.quantity',
          details: { schema: 'public', objectType: 'table', name: 'stock_movements' },
        },
        precheck: [],
        execute: [{ description: 'no-op', sql: 'SELECT 1 WHERE FALSE' }],
        postcheck: [],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'stock_movements',
        column: 'quantity',
        options: {
          qualifiedTargetType: 'numeric(12,3)',
          formatTypeExpected: 'numeric(12,3)',
          rawTargetTypeForLabel: 'numeric(12,3)',
        },
      }),
      rawSql({
        id: 'data.typechange.wastage.quantity',
        label: 'No row rewrite needed: int → numeric(12,3) is lossless',
        operationClass: 'data',
        target: {
          id: 'data.typechange.wastage.quantity',
          details: { schema: 'public', objectType: 'table', name: 'wastage' },
        },
        precheck: [],
        execute: [{ description: 'no-op', sql: 'SELECT 1 WHERE FALSE' }],
        postcheck: [],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'wastage',
        column: 'quantity',
        options: {
          qualifiedTargetType: 'numeric(12,3)',
          formatTypeExpected: 'numeric(12,3)',
          rawTargetTypeForLabel: 'numeric(12,3)',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
