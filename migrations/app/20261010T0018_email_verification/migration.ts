#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/48d5dde1cbaa773fe6c1d7ea4f368460df3325f38e54028f06bc2b921218d962/contract';
import endContract from '../../snapshots/48d5dde1cbaa773fe6c1d7ea4f368460df3325f38e54028f06bc2b921218d962/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/67f9d5cf657bf732c84c7c5cfbc348c3b50137d5a172a186ccadacabba12cda9/contract';
import startContract from '../../snapshots/67f9d5cf657bf732c84c7c5cfbc348c3b50137d5a172a186ccadacabba12cda9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'email_verification_rates',
        columns: [
          col('count', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('expires_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['key'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('email_verified_at', 'timestamptz', {
          default: fn('now()'),
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('pending_email', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('verification_expires_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('verification_send_count', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('verification_sent_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('verification_token_hash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('verification_window_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_verification_token_hash_key',
        columns: ['verification_token_hash'],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'email_verification_rates' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'email_verification_rates',
        policy: {
          naming: { kind: 'wire', prefix: 'email_verification_rates_private', hash: '1b02389a' },
          tableName: 'email_verification_rates',
          namespaceId: 'public',
          operation: 'all',
          roles: [],
          using: "nullif(current_setting('app.bypass_rls', true), '') = 'on'",
          withCheck: "nullif(current_setting('app.bypass_rls', true), '') = 'on'",
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
