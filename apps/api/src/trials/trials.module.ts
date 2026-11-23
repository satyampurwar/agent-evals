/**
 * Nest feature module for reading trials and traces (write path is ExecutionModule).
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceStoreModule } from '../common/trace-store.module.js';
import { TrialEntity } from '../entities/trial.entity.js';
import { TrialsController } from './trials.controller.js';
import { TrialsService } from './trials.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([TrialEntity]), TraceStoreModule],
  controllers: [TrialsController],
  providers: [TrialsService],
  exports: [TrialsService],
})
export class TrialsModule {}
