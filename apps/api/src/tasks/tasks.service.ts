/**
 * Business logic for the task catalog.
 *
 * `@InjectRepository(TaskEntity)` is TypeORM+Nest: Nest injects a Repository that can
 * `find` / `save` / run transactions against the `tasks` table. Services throw Nest
 * HTTP exceptions (`NotFoundException`, `ConflictException`, …) which controllers
 * do not catch — Nest turns them into the right status codes automatically.
 *
 * Import rule of thumb: same (id, version) + same content = no-op; same version +
 * different content = conflict (bump the version in the JSON file instead).
 */
import { ConflictException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Task } from '@agent-evals/domain';
import { Repository } from 'typeorm';
import { contentHash } from '../common/canonical-json.js';
import { TaskEntity } from '../entities/task.entity.js';

export interface TaskImportResult {
  created: { id: string; version: string }[];
  unchanged: { id: string; version: string }[];
}

@Injectable()
export class TasksService {
  constructor(@InjectRepository(TaskEntity) private readonly repo: Repository<TaskEntity>) {}

  /**
   * Upserts tasks by (id, version). Re-importing identical content is a no-op; changing content
   * under an existing version is rejected, because trials pin task versions and must stay reproducible.
   * The whole batch is one transaction: any conflict rolls back everything.
   */
  async import(tasks: Task[]): Promise<TaskImportResult> {
    const seen = new Set<string>();
    for (const task of tasks) {
      const key = `${task.id}@${task.version}`;
      if (seen.has(key)) {
        throw new BadRequestException(`duplicate task in payload: ${key}`);
      }
      seen.add(key);
    }

    return this.repo.manager.transaction(async (manager) => {
      const result: TaskImportResult = { created: [], unchanged: [] };
      for (const task of tasks) {
        const hash = contentHash(task);
        const existing = await manager.findOne(TaskEntity, {
          where: { id: task.id, version: task.version },
        });
        if (!existing) {
          // create + save (not insert) because TypeORM's insert typing rejects the `unknown` fields inside Task.
          const row = manager.create(TaskEntity, {
            id: task.id,
            version: task.version,
            name: task.name,
            contentHash: hash,
            document: task,
          });
          await manager.save(row);
          result.created.push({ id: task.id, version: task.version });
        } else if (existing.contentHash === hash) {
          result.unchanged.push({ id: task.id, version: task.version });
        } else {
          throw new ConflictException(
            `task ${task.id}@${task.version} already exists with different content; bump the version instead`,
          );
        }
      }
      return result;
    });
  }

  async findAll(): Promise<TaskEntity[]> {
    return this.repo.find({ order: { id: 'ASC', version: 'ASC' } });
  }

  /** Returns the requested version, or the most recently imported version when none is given. */
  async findOne(id: string, version?: string): Promise<TaskEntity> {
    const row = version
      ? await this.repo.findOne({ where: { id, version } })
      : await this.repo.findOne({ where: { id }, order: { createdAt: 'DESC' } });
    if (!row) {
      throw new NotFoundException(version ? `task ${id}@${version} not found` : `task ${id} not found`);
    }
    return row;
  }
}
