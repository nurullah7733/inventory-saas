#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/145e2becdc3aa1c9f836640eec5e15e9d53bcee46013f88b7abb92eb6cbc1909/contract';
import endContract from '../../snapshots/145e2becdc3aa1c9f836640eec5e15e9d53bcee46013f88b7abb92eb6cbc1909/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/710b960edd125395c4714fb204b4f839475808ea94df0f24b42d7a5379ac0ba2/contract';
import startContract from '../../snapshots/710b960edd125395c4714fb204b4f839475808ea94df0f24b42d7a5379ac0ba2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

/**
 * ENABLE ROW LEVEL SECURITY leaves one hole: Postgres exempts a table's OWNER
 * from its own policies. The app avoids that by connecting as `app_runtime`
 * rather than as the owner (see prisma/contract.prisma), but FORCE closes the
 * hole at the database instead of relying on every future connection string
 * being the right one — a migration script, a psql session or a misconfigured
 * deploy that lands on the owner role is then still filtered.
 *
 * Prisma Next has no contract-level spelling for the FORCE flag (the contract
 * models ENABLE and the policies themselves), so it is issued here as raw DDL,
 * in the same transaction as the ENABLE and the CREATE POLICY statements —
 * a database is never left enabled-but-unforced.
 *
 * Kept in the same order as the planner's ENABLE operations so a diff of this
 * file reads straight down.
 */
const FORCE_RLS_TABLES = [
  'audit_logs',
  'categories',
  'customers',
  'expense_categories',
  'expenses',
  'products',
  'refresh_sessions',
  'returns',
  'sale_items',
  'sales',
  'stock_movements',
  'subscriptions',
  'supplier_payments',
  'suppliers',
  'tenants',
  'users',
  'variant_colors',
  'variant_sizes',
  'variant_units',
  'variant_weights',
  'wastage',
] as const;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      ...FORCE_RLS_TABLES.map((table) =>
        rawSql({
          id: `rowLevelSecurity.force.public.${table}`,
          label: `Force row-level security on "${table}"`,
          operationClass: 'additive',
          target: {
            id: `rowLevelSecurity.force.public.${table}`,
            details: {
              schema: 'public',
              objectType: 'rowLevelSecurity',
              name: table,
              table,
            },
          },
          precheck: [],
          execute: [
            {
              description: `force row-level security on "${table}"`,
              sql: `ALTER TABLE "public"."${table}" FORCE ROW LEVEL SECURITY`,
            },
          ],
          postcheck: [],
        }),
      ),
      this.enableRowLevelSecurity({ schema: 'public', table: 'audit_logs' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'categories' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'customers' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'expense_categories' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'expenses' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'products' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'refresh_sessions' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'returns' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sale_items' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sales' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'stock_movements' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'subscriptions' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'supplier_payments' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'suppliers' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'tenants' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'users' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'variant_colors' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'variant_sizes' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'variant_units' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'variant_weights' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'wastage' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'audit_logs',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_audit_logs', hash: 'ffe271ab' },
          tableName: 'audit_logs',
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
        table: 'categories',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_categories', hash: 'ffe271ab' },
          tableName: 'categories',
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
        table: 'customers',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_customers', hash: 'ffe271ab' },
          tableName: 'customers',
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
        table: 'expense_categories',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'tenant_isolation_expense_categories',
            hash: 'ffe271ab',
          },
          tableName: 'expense_categories',
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
        table: 'expenses',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_expenses', hash: 'ffe271ab' },
          tableName: 'expenses',
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
        table: 'products',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_products', hash: 'ffe271ab' },
          tableName: 'products',
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
        table: 'refresh_sessions',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_refresh_sessions', hash: 'ffe271ab' },
          tableName: 'refresh_sessions',
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
        table: 'returns',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_returns', hash: 'ffe271ab' },
          tableName: 'returns',
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
        table: 'sale_items',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_sale_items', hash: 'ffe271ab' },
          tableName: 'sale_items',
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
        table: 'sales',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_sales', hash: 'ffe271ab' },
          tableName: 'sales',
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
        table: 'stock_movements',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_stock_movements', hash: 'ffe271ab' },
          tableName: 'stock_movements',
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
        table: 'subscriptions',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_subscriptions', hash: 'ffe271ab' },
          tableName: 'subscriptions',
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
        table: 'supplier_payments',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_supplier_payments', hash: 'ffe271ab' },
          tableName: 'supplier_payments',
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
        table: 'suppliers',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_suppliers', hash: 'ffe271ab' },
          tableName: 'suppliers',
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
        table: 'tenants',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_tenants', hash: '18ee00e3' },
          tableName: 'tenants',
          namespaceId: 'public',
          operation: 'all',
          roles: [],
          using:
            "nullif(current_setting('app.bypass_rls', true), '') = 'on' OR id = nullif(current_setting('app.tenant_id', true), '')::uuid",
          withCheck:
            "nullif(current_setting('app.bypass_rls', true), '') = 'on' OR id = nullif(current_setting('app.tenant_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'users',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_users', hash: 'ffe271ab' },
          tableName: 'users',
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
        table: 'variant_colors',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_variant_colors', hash: 'ffe271ab' },
          tableName: 'variant_colors',
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
        table: 'variant_sizes',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_variant_sizes', hash: 'ffe271ab' },
          tableName: 'variant_sizes',
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
        table: 'variant_units',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_variant_units', hash: 'ffe271ab' },
          tableName: 'variant_units',
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
        table: 'variant_weights',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_variant_weights', hash: 'ffe271ab' },
          tableName: 'variant_weights',
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
        table: 'wastage',
        policy: {
          naming: { kind: 'wire', prefix: 'tenant_isolation_wastage', hash: 'ffe271ab' },
          tableName: 'wastage',
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
