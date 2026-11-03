#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/05d055f9e7d9037e902082575befae52fa21a0d661b8df1ef07446a03a4fca4a/contract';
import endContract from '../../snapshots/05d055f9e7d9037e902082575befae52fa21a0d661b8df1ef07446a03a4fca4a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/93e797b53394cc25595a20aa1c5050ad5c752ecd1d653565f3d4bf9a1623b962/contract';
import startContract from '../../snapshots/93e797b53394cc25595a20aa1c5050ad5c752ecd1d653565f3d4bf9a1623b962/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'commission_payments',
        columns: [
          col('amount', 'numeric(10,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('period_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commission_periods',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('month', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rate', 'numeric(5,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 5, scale: 2 } },
          }),
          col('target', 'numeric(10,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          }),
          col('tenant_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('completed_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('creator_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('creator_name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('seller_name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'commission_periods',
        constraint: 'commission_periods_tenant_id_user_id_month_key',
        columns: ['tenant_id', 'user_id', 'month'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_payments',
        index: 'commission_payments_created_by_idx_e13bb8bf',
        columns: ['created_by'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_payments',
        index: 'commission_payments_period_id_idx_b79c59e2',
        columns: ['period_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_payments',
        index: 'commission_payments_tenant_id_idx_41c0d441',
        columns: ['tenant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_payments',
        index: 'commission_payments_tenant_id_period_id_idx_07cdee7b',
        columns: ['tenant_id', 'period_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_periods',
        index: 'commission_periods_tenant_id_idx_41c0d441',
        columns: ['tenant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_periods',
        index: 'commission_periods_tenant_id_month_idx_679f81dc',
        columns: ['tenant_id', 'month'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commission_periods',
        index: 'commission_periods_user_id_idx_6c952402',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales',
        index: 'sales_creator_id_idx_c8bab67a',
        columns: ['creator_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales',
        index: 'sales_tenant_id_sold_by_completed_at_idx_a01b5e68',
        columns: ['tenant_id', 'sold_by', 'completed_at'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'commission_payments',
        foreignKey: {
          name: 'commission_payments_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'commission_payments',
        foreignKey: {
          name: 'commission_payments_period_id_fkey',
          columns: ['period_id'],
          references: { schema: 'public', table: 'commission_periods', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'commission_payments',
        foreignKey: {
          name: 'commission_payments_created_by_fkey',
          columns: ['created_by'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'commission_periods',
        foreignKey: {
          name: 'commission_periods_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'commission_periods',
        foreignKey: {
          name: 'commission_periods_user_id_fkey',
          columns: ['user_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales',
        foreignKey: {
          name: 'sales_creator_id_fkey',
          columns: ['creator_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'commission_payments' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'commission_periods' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'commission_payments',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'tenant_isolation_commission_payments',
            hash: 'ffe271ab',
          },
          tableName: 'commission_payments',
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
      this.createRlsPolicy({
        schema: 'public',
        table: 'commission_periods',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'tenant_isolation_commission_periods',
            hash: 'ffe271ab',
          },
          tableName: 'commission_periods',
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
