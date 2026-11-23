/**
 * TypeORM entity = one Postgres table row shape.
 *
 * TypeORM maps decorated classes to SQL. `@Entity('tasks')` → table `tasks`.
 * `@PrimaryColumn` / `@Column` define columns. The full task JSON lives in
 * `document` (jsonb) so the API can return the Zod-validated Task without
 * flattening every field into columns.
 *
 * Immutability: (id, version) is never rewritten with different content. Experiments
 * pin a version at create time so re-seeding later cannot change past runs.
 */
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
