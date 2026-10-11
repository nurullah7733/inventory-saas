#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/285afc5b467419ea5697fc72de01e47123c1c72ffe36b954c4b6828bf03519ef/contract';
import endContract from '../../snapshots/285afc5b467419ea5697fc72de01e47123c1c72ffe36b954c4b6828bf03519ef/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e487653eb58d18fd41c16a71cfae7034be0d9a606ca7ef5a86ce451e78bbac64/contract';
import startContract from '../../snapshots/e487653eb58d18fd41c16a71cfae7034be0d9a606ca7ef5a86ce451e78bbac64/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'brands',
        columns: [
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
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'products',
        column: col('brand_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      rawSql({
        id: 'data.backfill_brands_from_products',
        label: 'Backfill Brand rows from existing product.brand values',
        operationClass: 'data',
        target: {
          id: 'data.backfill_brands_from_products',
          details: { schema: 'public', objectType: 'table', name: 'brands' },
        },
        precheck: [],
        execute: [
          {
            description: 'Create Brand rows for each distinct product.brand and link products',
            sql: `WITH distinct_brands AS (
  SELECT DISTINCT "tenant_id", "brand" AS "name"
  FROM "public"."products"
  WHERE "brand" IS NOT NULL AND "brand" <> ''
),
inserted AS (
  INSERT INTO "public"."brands" ("id", "tenant_id", "name", "is_active", "created_at", "updated_at")
  SELECT gen_random_uuid(), "tenant_id", "name", true, now(), now()
  FROM distinct_brands
  RETURNING "id", "tenant_id", "name"
)
UPDATE "public"."products" p
SET "brand_id" = i."id"
FROM inserted i
WHERE p."tenant_id" = i."tenant_id" AND p."brand" = i."name"`,
          },
        ],
        postcheck: [],
      }),
      this.dropColumn({ schema: 'public', table: 'products', column: 'brand' }),
      this.addUnique({
        schema: 'public',
        table: 'brands',
        constraint: 'brands_tenant_id_name_key',
        columns: ['tenant_id', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brands',
        index: 'brands_tenant_id_created_at_idx_282da036',
        columns: ['tenant_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brands',
        index: 'brands_tenant_id_id_idx_621bc114',
        columns: ['tenant_id', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brands',
        index: 'brands_tenant_id_idx_41c0d441',
        columns: ['tenant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'products',
        index: 'products_brand_id_idx_59ec1fe6',
        columns: ['brand_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brands',
        foreignKey: {
          name: 'brands_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'products',
        foreignKey: {
          name: 'products_brand_id_fkey',
          columns: ['brand_id'],
          references: { schema: 'public', table: 'brands', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'brands' }),
      rawSql({
        id: 'rowLevelSecurity.force.public.brands',
        label: 'Force row-level security on "brands"',
        operationClass: 'additive',
        target: {
          id: 'rowLevelSecurity.force.public.brands',
          details: { schema: 'public', objectType: 'rowLevelSecurity', name: 'brands', table: 'brands' },
        },
        precheck: [],
        execute: [
          {
            description: 'force row-level security on "brands"',
            sql: 'ALTER TABLE "public"."brands" FORCE ROW LEVEL SECURITY',
          },
        ],
        postcheck: [],
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'brands',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_brands', hash: 'ffe271ab' },
          tableName: 'brands',
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
