import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrialEntity } from '../entities/trial.entity.js';
import { TrialsController } from './trials.controller.js';
import { TrialsService } from './trials.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([TrialEntity])],
  controllers: [TrialsController],
  providers: [TrialsService],
  exports: [TrialsService],
})
export class TrialsModule {}
