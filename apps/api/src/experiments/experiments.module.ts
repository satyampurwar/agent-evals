import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigsModule } from '../configs/configs.module.js';
import { ExperimentEntity } from '../entities/experiment.entity.js';
import { TrialEntity } from '../entities/trial.entity.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { ExperimentsController } from './experiments.controller.js';
import { ExperimentsService } from './experiments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExperimentEntity, TrialEntity]),
    TasksModule,
    ConfigsModule,
  ],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
