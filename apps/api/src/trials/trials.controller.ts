import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { TrialsService } from './trials.service.js';

@Controller('trials')
export class TrialsController {
  constructor(private readonly trials: TrialsService) {}

  @Get()
  list(@Query('experimentId', new ParseUUIDPipe({ optional: true })) experimentId?: string) {
    return this.trials.list(experimentId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.trials.findOne(id);
  }

  @Get(':id/trace')
  trace(@Param('id', ParseUUIDPipe) id: string) {
    return this.trials.trace(id);
  }
}
