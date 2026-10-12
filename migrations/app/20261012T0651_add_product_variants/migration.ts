#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/285afc5b467419ea5697fc72de01e47123c1c72ffe36b954c4b6828bf03519ef/contract';
import startContract from '../../snapshots/285afc5b467419ea5697fc72de01e47123c1c72ffe36b954c4b6828bf03519ef/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c2f37152cb0f3f65a4b7966010f32ae496a3851665bf6fca107131b5673efc66/contract';
import endContract from '../../snapshots/c2f37152cb0f3f65a4b7966010f32ae496a3851665bf6fca107131b5673efc66/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  rawSql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'product_variants',
        columns: [
          col('barcode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('color_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('cost_price', 'numeric(10,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('is_active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('product_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('sell_price', 'numeric(10,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          }),
          col('size_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('sku', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stock_qty', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('weight_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'products',
        column: col('reorder_level', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sale_items',
        column: col('variant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('variant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'wastage',
        column: col('variant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      rawSql({
        id: 'data.backfill_default_variants',
        label: 'Create one "Default" variant per existing product, inheriting sku, prices, stock and the product-level size/color/weight',
        operationClass: 'data',
        target: {
          id: 'data.backfill_default_variants',
          details: { schema: 'public', objectType: 'table', name: 'product_variants' },
        },
        precheck: [],
        execute: [
          {
            description: 'Insert a Default ProductVariant row for every product',
            sql: `INSERT INTO "public"."product_variants" ("id", "tenant_id", "product_id", "sku", "barcode", "label", "size_id", "color_id", "weight_id", "cost_price", "sell_price", "stock_qty", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), "tenant_id", "id", "sku", NULL, 'Default', "size_id", "color_id", "weight_id", "cost_price", "sell_price", "stock_qty", true, "created_at", now()
FROM "public"."products"`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'data.backfill_stock_movements_variant_id',
        label: 'Re-point stock_movements.variant_id at the product Default variant',
        operationClass: 'data',
        target: {
          id: 'data.backfill_stock_movements_variant_id',
          details: { schema: 'public', objectType: 'table', name: 'stock_movements' },
        },
        precheck: [],
        execute: [
          {
            description: 'Set variant_id from the product Default variant',
            sql: `UPDATE "public"."stock_movements" AS "sm"
SET "variant_id" = "pv"."id"
FROM "public"."product_variants" AS "pv"
WHERE "pv"."product_id" = "sm"."product_id" AND "pv"."label" = 'Default'`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'data.backfill_sale_items_variant_id',
        label: 'Re-point sale_items.variant_id at the product Default variant',
        operationClass: 'data',
        target: {
          id: 'data.backfill_sale_items_variant_id',
          details: { schema: 'public', objectType: 'table', name: 'sale_items' },
        },
        precheck: [],
        execute: [
          {
            description: 'Set variant_id from the product Default variant',
            sql: `UPDATE "public"."sale_items" AS "si"
SET "variant_id" = "pv"."id"
FROM "public"."product_variants" AS "pv"
WHERE "pv"."product_id" = "si"."product_id" AND "pv"."label" = 'Default'`,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'data.backfill_wastage_variant_id',
        label: 'Re-point wastage.variant_id at the product Default variant',
        operationClass: 'data',
        target: {
          id: 'data.backfill_wastage_variant_id',
          details: { schema: 'public', objectType: 'table', name: 'wastage' },
        },
        precheck: [],
        execute: [
          {
            description: 'Set variant_id from the product Default variant',
            sql: `UPDATE "public"."wastage" AS "w"
SET "variant_id" = "pv"."id"
FROM "public"."product_variants" AS "pv"
WHERE "pv"."product_id" = "w"."product_id" AND "pv"."label" = 'Default'`,
          },
        ],
        postcheck: [],
      }),
      this.setNotNull({ schema: 'public', table: 'sale_items', column: 'variant_id' }),
      this.setNotNull({ schema: 'public', table: 'stock_movements', column: 'variant_id' }),
      this.setNotNull({ schema: 'public', table: 'wastage', column: 'variant_id' }),
      this.dropConstraint({
        schema: 'public',
        table: 'products',
        constraint: 'products_color_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'products',
        constraint: 'products_size_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'products',
        constraint: 'products_weight_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'products',
        index: 'products_color_id_idx_34d8d0d9',
      }),
      this.dropColumn({ schema: 'public', table: 'products', column: 'color_id' }),
      this.dropIndex({
        schema: 'public',
        table: 'products',
        index: 'products_size_id_idx_6a72a89a',
      }),
      this.dropColumn({ schema: 'public', table: 'products', column: 'size_id' }),
      this.dropIndex({
        schema: 'public',
        table: 'products',
        index: 'products_weight_id_idx_7c4ea817',
      }),
      this.dropColumn({ schema: 'public', table: 'products', column: 'weight_id' }),
      this.addUnique({
        schema: 'public',
        table: 'product_variants',
        constraint: 'product_variants_tenant_id_sku_key',
        columns: ['tenant_id', 'sku'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'product_variants',
        constraint: 'product_variants_tenant_id_barcode_key',
        columns: ['tenant_id', 'barcode'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'product_variants',
        constraint: 'product_variants_product_id_label_key',
        columns: ['product_id', 'label'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_color_id_idx_34d8d0d9',
        columns: ['color_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_product_id_idx_22a2b7d2',
        columns: ['product_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_size_id_idx_6a72a89a',
        columns: ['size_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_tenant_id_id_idx_621bc114',
        columns: ['tenant_id', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_tenant_id_idx_41c0d441',
        columns: ['tenant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_tenant_id_is_active_idx_930fdf5b',
        columns: ['tenant_id', 'is_active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_tenant_id_product_id_idx_724dd954',
        columns: ['tenant_id', 'product_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_variants',
        index: 'product_variants_weight_id_idx_7c4ea817',
        columns: ['weight_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_items',
        index: 'sale_items_tenant_id_variant_id_idx_cef0b336',
        columns: ['tenant_id', 'variant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_items',
        index: 'sale_items_variant_id_idx_4a7fac73',
        columns: ['variant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_tenant_id_variant_id_idx_cef0b336',
        columns: ['tenant_id', 'variant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_variant_id_idx_4a7fac73',
        columns: ['variant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'wastage',
        index: 'wastage_tenant_id_variant_id_idx_cef0b336',
        columns: ['tenant_id', 'variant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'wastage',
        index: 'wastage_variant_id_idx_4a7fac73',
        columns: ['variant_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_variants',
        foreignKey: {
          name: 'product_variants_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_variants',
        foreignKey: {
          name: 'product_variants_product_id_fkey',
          columns: ['product_id'],
          references: { schema: 'public', table: 'products', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_variants',
        foreignKey: {
          name: 'product_variants_size_id_fkey',
          columns: ['size_id'],
          references: { schema: 'public', table: 'variant_sizes', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_variants',
        foreignKey: {
          name: 'product_variants_color_id_fkey',
          columns: ['color_id'],
          references: { schema: 'public', table: 'variant_colors', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_variants',
        foreignKey: {
          name: 'product_variants_weight_id_fkey',
          columns: ['weight_id'],
          references: { schema: 'public', table: 'variant_weights', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_items',
        foreignKey: {
          name: 'sale_items_variant_id_fkey',
          columns: ['variant_id'],
          references: { schema: 'public', table: 'product_variants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_variant_id_fkey',
          columns: ['variant_id'],
          references: { schema: 'public', table: 'product_variants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'wastage',
        foreignKey: {
          name: 'wastage_variant_id_fkey',
          columns: ['variant_id'],
          references: { schema: 'public', table: 'product_variants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'product_variants' }),
      rawSql({
        id: 'rowLevelSecurity.force.public.product_variants',
        label: 'Force row-level security on "product_variants"',
        operationClass: 'additive',
        target: {
          id: 'rowLevelSecurity.force.public.product_variants',
          details: { schema: 'public', objectType: 'rowLevelSecurity', name: 'product_variants', table: 'product_variants' },
        },
        precheck: [],
        execute: [
          {
            description: 'force row-level security on "product_variants"',
            sql: 'ALTER TABLE "public"."product_variants" FORCE ROW LEVEL SECURITY',
          },
        ],
        postcheck: [],
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'product_variants',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_product_variants', hash: 'ffe271ab' },
          tableName: 'product_variants',
          namespaceId: 'public',
          operation: 'all',
          roles: [],
          using:
            "nullif(current_setting('app.bypass_rls', true), '') = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid",
          withCheck:
            "nullif(current_setting('app.bypass_rls', true), '') = 'on' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid",
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
