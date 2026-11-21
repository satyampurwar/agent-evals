import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigsModule } from './configs/configs.module.js';
import { ConfigEntity } from './entities/config.entity.js';
import { ExperimentEntity } from './entities/experiment.entity.js';
import { TaskEntity } from './entities/task.entity.js';
import { TrialEntity } from './entities/trial.entity.js';
import { ExperimentsModule } from './experiments/experiments.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TrialsModule } from './trials/trials.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

const entities = [TaskEntity, ConfigEntity, ExperimentEntity, TrialEntity];

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'api',
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL is not set (add it to .env, see docker-compose.yml)');
        }
        return {
          type: 'postgres',
          url,
          entities,
          // Local dev only: create/alter tables from the entities on boot.
          // Set DB_SYNCHRONIZE=false once real migrations exist.
          synchronize: process.env.DB_SYNCHRONIZE !== 'false',
        };
      },
    }),
    TasksModule,
    ConfigsModule,
    ExperimentsModule,
    TrialsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
