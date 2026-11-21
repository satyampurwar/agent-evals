import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import type { Experiment } from '@agent-evals/domain';
import { TrialEntity } from './trial.entity.js';

/** Task and config versions are pinned when the experiment is created, not when it starts. */
export interface TaskRef {
  id: string;
  version: string;
  contentHash: string;
}

export interface ConfigRef {
  id: string;
  contentHash: string;
}

export type ExperimentStatus = Experiment['status'];

@Entity('experiments')
export class ExperimentEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  name!: string;

  @Column({ type: 'text', nullable: true })
  hypothesis!: string | null;

  @Column('jsonb')
  taskRefs!: TaskRef[];

  @Column('jsonb')
  configRefs!: ConfigRef[];

  @Column('int')
  nTrials!: number;

  @Column('text')
  status!: ExperimentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => TrialEntity, (t) => t.experiment)
  trials?: TrialEntity[];
}
