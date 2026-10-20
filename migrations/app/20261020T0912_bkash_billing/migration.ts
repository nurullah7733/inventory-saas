#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5124a86dd5a151c66ac58686cce3bf7936f661d629a38a6f9350a3bf4f6c2f8f/contract';
import startContract from '../../snapshots/5124a86dd5a151c66ac58686cce3bf7936f661d629a38a6f9350a3bf4f6c2f8f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/755c42db8f08439e5f7fa803b5d54170d08e2542a13a658fafca7d417bae2e62/contract';
import endContract from '../../snapshots/755c42db8f08439e5f7fa803b5d54170d08e2542a13a658fafca7d417bae2e62/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'subscriptions', column: 'stripe_customer_id' }),
      this.dropIndex({
        schema: 'public',
        table: 'subscriptions',
        index: 'subscriptions_stripe_subscription_id_idx_2362abe2',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'subscriptions',
        column: 'stripe_subscription_id',
      }),
      this.addColumn({
        schema: 'public',
        table: 'subscriptions',
        column: col('callback_token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'subscriptions',
        column: col('checkout_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'subscriptions',
        column: col('paid_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'subscriptions',
        column: col('payment_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'subscriptions',
        column: col('transaction_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'subscriptions',
        constraint: 'subscriptions_payment_id_key',
        columns: ['payment_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'subscriptions',
        constraint: 'subscriptions_transaction_id_key',
        columns: ['transaction_id'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
