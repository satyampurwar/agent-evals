/**
 * Nest feature module for immutable agent configs (harness + model + budgets).
 * Exports ConfigsService so ExperimentsModule can resolve config ids at create time.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigEntity } from '../entities/config.entity.js';
import { ConfigsController } from './configs.controller.js';
import { ConfigsService } from './configs.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ConfigEntity])],
  controllers: [ConfigsController],
  providers: [ConfigsService],
  exports: [ConfigsService],
})
export class ConfigsModule {}
