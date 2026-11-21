import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { Task } from '@agent-evals/domain';

/** One row per (task id, version). Rows are never updated, so a trial's task version always resolves. */
@Entity('tasks')
export class TaskEntity {
  @PrimaryColumn('text')
  id!: string;

  @PrimaryColumn('text')
  version!: string;

  @Column('text')
  name!: string;

  @Column('text')
  contentHash!: string;

  @Column('jsonb')
  document!: Task;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
