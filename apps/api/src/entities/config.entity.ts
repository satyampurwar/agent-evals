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
