#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/145e2becdc3aa1c9f836640eec5e15e9d53bcee46013f88b7abb92eb6cbc1909/contract';
import startContract from '../../snapshots/145e2becdc3aa1c9f836640eec5e15e9d53bcee46013f88b7abb92eb6cbc1909/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/334c80fa7b5c8248eaa7db4bed7ccf2ca12cb6d2abf3a8a77178e5514286aee2/contract';
import endContract from '../../snapshots/334c80fa7b5c8248eaa7db4bed7ccf2ca12cb6d2abf3a8a77178e5514286aee2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropNotNull({ schema: 'public', table: 'audit_logs', column: 'user_id' })];
  }
}

MigrationCLI.run(import.meta.url, M);
