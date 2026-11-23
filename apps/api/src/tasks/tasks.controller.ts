/**
 * HTTP routes under `/tasks`.
 *
 * Nest decorators map HTTP → methods:
 * - `@Controller('tasks')` → base path `/tasks`
 * - `@Post('import')` → POST /tasks/import
 * - `@Get()` / `@Get(':id')` → list and fetch
 * - `@Body(new ZodValidationPipe(TaskImportSchema))` validates JSON with Zod before the method runs
 *
 * Controllers should stay thin: parse/validate HTTP, call the service, return JSON.
 * Persistence and rules live in TasksService.
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TaskImportSchema, type TaskImport } from '@agent-evals/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TasksService, type TaskImportResult } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** Bulk upsert from the task catalog (also used by `npm run seed:tasks`). */
  @Post('import')
  importTasks(
    @Body(new ZodValidationPipe(TaskImportSchema)) body: TaskImport,
  ): Promise<TaskImportResult> {
    return this.tasks.import(body.tasks);
  }

  /** Lightweight listing (metadata only — full prompt/graders via GET :id). */
  @Get()
  async list() {
    const rows = await this.tasks.findAll();
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      name: row.name,
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    }));
  }

  /** Full task document. Optional `?version=` picks a specific version; default = latest import. */
  @Get(':id')
  async get(@Param('id') id: string, @Query('version') version?: string) {
    const row = await this.tasks.findOne(id, version);
    return row.document;
  }
}
