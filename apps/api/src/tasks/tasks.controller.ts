import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TaskImportSchema, type TaskImport } from '@agent-evals/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TasksService, type TaskImportResult } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('import')
  importTasks(
    @Body(new ZodValidationPipe(TaskImportSchema)) body: TaskImport,
  ): Promise<TaskImportResult> {
    return this.tasks.import(body.tasks);
  }

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

  @Get(':id')
  async get(@Param('id') id: string, @Query('version') version?: string) {
    const row = await this.tasks.findOne(id, version);
    return row.document;
  }
}
