/**
 * Read-only HTTP API for trials and their traces.
 *
 * Trials are created by ExperimentsService.start (not here). This controller only
 * lists/fetches results for the UI. The heavy transcript is a separate resource
 * (`GET /trials/:id/trace`) so list views stay small.
 */
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { TrialsService } from './trials.service.js';

@Controller('trials')
export class TrialsController {
  constructor(private readonly trials: TrialsService) {}

  /** Optional `?experimentId=` filters to one experiment's matrix. */
  @Get()
  list(@Query('experimentId', new ParseUUIDPipe({ optional: true })) experimentId?: string) {
    return this.trials.list(experimentId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.trials.findOne(id);
  }

  /** Full Trace JSON (messages, tool calls, errors) from the on-disk TraceStore. */
  @Get(':id/trace')
  trace(@Param('id', ParseUUIDPipe) id: string) {
    return this.trials.trace(id);
  }
}
