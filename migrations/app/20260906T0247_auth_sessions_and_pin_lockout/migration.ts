#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/710b960edd125395c4714fb204b4f839475808ea94df0f24b42d7a5379ac0ba2/contract';
import endContract from '../../snapshots/710b960edd125395c4714fb204b4f839475808ea94df0f24b42d7a5379ac0ba2/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e2bcc2e212e0ef535c15ccacfc3efc36ce5b2f7c26954f970ebe8c096236a85f/contract';
import startContract from '../../snapshots/e2bcc2e212e0ef535c15ccacfc3efc36ce5b2f7c26954f970ebe8c096236a85f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'refresh_sessions',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('device_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expires_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('ip_address', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('last_used_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('revoked_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('tenant_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('token_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('user_agent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('last_login_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('pin_failed_attempts', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('pin_locked_until', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'refresh_sessions',
        constraint: 'refresh_sessions_token_hash_key',
        columns: ['token_hash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_tenant_id_created_at_idx_282da036',
        columns: ['tenant_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_tenant_id_idx_41c0d441',
        columns: ['tenant_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_user_id_expires_at_idx_d5534b1f',
        columns: ['user_id', 'expires_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_user_id_idx_6c952402',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_tenant_id_role_idx_03d3eda3',
        columns: ['tenant_id', 'role'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refresh_sessions',
        foreignKey: {
          name: 'refresh_sessions_user_id_fkey',
          columns: ['user_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refresh_sessions',
        foreignKey: {
          name: 'refresh_sessions_tenant_id_fkey',
          columns: ['tenant_id'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
