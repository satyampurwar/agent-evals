/**
 * Agent configuration row (TypeORM → Postgres `configs` table).
 *
 * A Config is the "treatment arm" in an experiment: which harness (baseline/hermes),
 * which model, temperature, tools, memory on/off, budgets. Once stored it is immutable.
 *
 * Dedup: `contentHash` is a SHA-256 of the canonical JSON of name+harness+model.
 * Creating the same content twice returns the existing row (see ConfigsService.create).
 * Changing any setting → new hash → new row (and usually a bumped version for that name).
 */
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { Config } from '@agent-evals/domain';

/** Immutable once created. The same content always maps to the same row via contentHash. */
@Entity('configs')
export class ConfigEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  name!: string;

  @Column('int')
  version!: number;

  @Column({ type: 'text', unique: true })
  contentHash!: string;

  @Column('jsonb')
  document!: Config;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
