#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1d881a839b5f90e6a79f87fff477b7275be59769550f1acf1ea97adab9aaa424/contract';
import startContract from '../../snapshots/1d881a839b5f90e6a79f87fff477b7275be59769550f1acf1ea97adab9aaa424/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6eb2d706db788ac2f2737dfbb79a48e4938eebae3adb498003d49eaf21376330/contract';
import endContract from '../../snapshots/6eb2d706db788ac2f2737dfbb79a48e4938eebae3adb498003d49eaf21376330/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'article_labels',
        columns: [
          col('article_number', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('batch_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('variant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'article_labels',
        constraint: 'article_labels_tenant_id_article_number_key',
        columns: ['tenant_id', 'article_number'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'article_labels',
        index: 'article_labels_tenant_id_batch_id_idx_e3fa2dcf',
        columns: ['tenant_id', 'batch_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'article_labels',
        index: 'article_labels_tenant_id_idx_41c0d441',
        columns: ['tenant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'article_labels',
        index: 'article_labels_tenant_id_variant_id_idx_cef0b336',
        columns: ['tenant_id', 'variant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'article_labels',
        index: 'article_labels_variant_id_idx_4a7fac73',
        columns: ['variant_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'article_labels',
        foreignKey: {
          name: 'article_labels_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'article_labels',
        foreignKey: {
          name: 'article_labels_variant_id_fkey',
          columns: ['variant_id'],
          references: { schema: 'public', table: 'product_variants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'article_labels' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'article_labels',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_article_labels', hash: 'ffe271ab' },
          tableName: 'article_labels',
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
