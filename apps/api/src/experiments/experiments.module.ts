/**
 * Nest feature module for experiments (create, start, compare, export).
 *
 * Depends on TasksModule + ConfigsModule (to pin refs) and TrialQueueModule
 * (to enqueue jobs on start). Does not run trials itself — ExecutionModule does.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigsModule } from '../configs/configs.module.js';
import { ExperimentEntity } from '../entities/experiment.entity.js';
import { TrialEntity } from '../entities/trial.entity.js';
import { TrialQueueModule } from '../queue/trial-queue.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { ExperimentsController } from './experiments.controller.js';
import { ExperimentsService } from './experiments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExperimentEntity, TrialEntity]),
    TasksModule,
    ConfigsModule,
    TrialQueueModule,
  ],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
