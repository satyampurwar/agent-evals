/**
 * HTTP routes under `/experiments` — the main orchestration surface.
 *
 * Lifecycle the UI/scripts follow:
 * 1. POST /experiments          → create (status=pending); pins task/config versions
 * 2. POST /experiments/:id/start → expand matrix into trial rows + enqueue BullMQ jobs (202)
 * 3. GET  /experiments/:id/status → poll counts while workers run
 * 4. GET  /experiments/:id/compare?a=&b= → stats package compares two configs
 * 5. GET  /experiments/:id/export → JSON or CSV download of all trials
 *
 * `@HttpCode(202)` = Accepted: work continues asynchronously after the response.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ExperimentInputSchema, type ExperimentInput } from '@agent-evals/domain';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { experimentToCsv } from './export.js';
import { ExperimentsService } from './experiments.service.js';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  async list() {
    const rows = await this.experiments.findAll();
    return rows.map((row) => this.experiments.toView(row));
  }

  @Post()
  async create(@Body(new ZodValidationPipe(ExperimentInputSchema)) body: ExperimentInput) {
    const experiment = await this.experiments.create(body);
    return this.experiments.toView(experiment);
  }

  /**
   * Materializes trial rows and enqueues one BullMQ job per trial.
   * Returns immediately (202); workers execute trials in the background.
   */
  @Post(':id/start')
  @HttpCode(202)
  async start(@Param('id', ParseUUIDPipe) id: string) {
    const { experiment, queued } = await this.experiments.start(id);
    return { ...this.experiments.toView(experiment), queued };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const experiment = await this.experiments.findOne(id);
    return this.experiments.toView(experiment);
  }

  /** Compares config `a` with config `b` on this experiment's scored trials. Delta is a minus b. */
  @Get(':id/compare')
  async compare(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('a', ParseUUIDPipe) a: string,
    @Query('b', ParseUUIDPipe) b: string,
  ) {
    return this.experiments.compare(id, a, b);
  }

  /**
   * Exports the experiment's trials. `format=json` (default) returns the experiment, its configs and
   * every trial. `format=csv` returns one row per trial (columns in TRIAL_EXPORT_COLUMNS).
   */
  @Get(':id/export')
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const chosen = format ?? 'json';
    if (chosen !== 'json' && chosen !== 'csv') {
      throw new BadRequestException(`format must be "json" or "csv", got "${chosen}"`);
    }
    const data = await this.experiments.exportData(id);
    res.setHeader('Content-Disposition', `attachment; filename="experiment-${id}.${chosen}"`);
    if (chosen === 'csv') {
      res.type('text/csv; charset=utf-8');
      return experimentToCsv(data);
    }
    return data;
  }

  @Get(':id/status')
  async status(@Param('id', ParseUUIDPipe) id: string) {
    const experiment = await this.experiments.findOne(id);
    return {
      experimentId: experiment.id,
      status: experiment.status,
      trials: await this.experiments.countTrials(experiment.id),
    };
  }

  /** Stretch: coarse failure categories for non-passing trials (status + stop reason + graders). */
  @Get(':id/failures')
  async failures(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.failureAnalysis(id);
  }
}
