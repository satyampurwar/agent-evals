import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ExperimentInputSchema, type ExperimentInput } from '@agent-evals/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ExperimentsService } from './experiments.service.js';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Post()
  async create(@Body(new ZodValidationPipe(ExperimentInputSchema)) body: ExperimentInput) {
    const experiment = await this.experiments.create(body);
    return this.experiments.toView(experiment);
  }

  /** Queues the trials. Execution is not implemented until the worker phase. */
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

  @Get(':id/status')
  async status(@Param('id', ParseUUIDPipe) id: string) {
    const experiment = await this.experiments.findOne(id);
    return {
      experimentId: experiment.id,
      status: experiment.status,
      trials: await this.experiments.countTrials(experiment.id),
    };
  }
}
