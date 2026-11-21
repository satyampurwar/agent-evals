import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  type Relation,
} from 'typeorm';
import type { GradeResult, Trace, Trial } from '@agent-evals/domain';
import { ExperimentEntity } from './experiment.entity.js';

export type TrialStatus = Trial['status'];

@Entity('trials')
@Unique(['experimentId', 'taskId', 'configId', 'trialIndex'])
export class TrialEntity {
  @PrimaryColumn('uuid')
  id!: string;

  // Relation<> (not a plain type) keeps emitDecoratorMetadata from referencing ExperimentEntity at
  // runtime; the two entity files import each other and a runtime reference fails at load time.
  @ManyToOne(() => ExperimentEntity, (e) => e.trials, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'experimentId' })
  experiment?: Relation<ExperimentEntity>;

  @Column('uuid')
  experimentId!: string;

  @Column('text')
  taskId!: string;

  @Column('text')
  taskVersion!: string;

  @Column('uuid')
  configId!: string;

  @Column('text')
  configContentHash!: string;

  @Column('int')
  trialIndex!: number;

  @Column('text')
  status!: TrialStatus;

  @Column('int')
  seed!: number;

  @Column({ type: 'double precision', nullable: true })
  score!: number | null;

  @Column({ type: 'boolean', nullable: true })
  passed!: boolean | null;

  @Column('jsonb', { default: {} })
  /** Empty until the trial finishes; Partial because a queued trial has no metrics yet. */
  metrics!: Partial<Trial['metrics']>;

  @Column({ type: 'jsonb', nullable: true })
  grade!: GradeResult | null;

  @Column({ type: 'jsonb', nullable: true })
  error!: Trial['error'] | null;

  /** Full trace, stored inline for now. Phase 7+ can move large traces to blob storage and fill traceUri. */
  @Column({ type: 'jsonb', nullable: true })
  trace!: Trace | null;

  @Column({ type: 'text', nullable: true })
  traceUri!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
