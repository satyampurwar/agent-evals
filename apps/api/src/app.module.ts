/**
 * Root NestJS module — the wiring diagram for the whole API.
 *
 * NestJS mental model:
 * - `@Module({ imports, controllers, providers })` declares what this slice of the
 *   app exposes and depends on. Nest builds a dependency-injection container from it.
 * - Feature modules (`TasksModule`, `ConfigsModule`, …) own their controllers + services.
 * - `TypeOrmModule.forRoot` = Postgres connection; entity classes map to tables.
 * - `BullModule.forRoot` = Redis connection for the trial job queue.
 *
 * Domain objects this API manages:
 *   Task  → what the agent is asked to do (+ graders)
 *   Config → immutable harness/model/settings (identified by contentHash)
 *   Experiment → matrix of (tasks × configs × nTrials)
 *   Trial → one cell of that matrix, executed asynchronously by ExecutionModule
 *
 * Both `main.ts` (HTTP) and `worker.ts` (queue-only) import this same module.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { createObserveModule } from '@nestjs/observe';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { redisConnection } from './common/redis.js';
import { ConfigsModule } from './configs/configs.module.js';
import { ConfigEntity } from './entities/config.entity.js';
import { ExperimentEntity } from './entities/experiment.entity.js';
import { TaskEntity } from './entities/task.entity.js';
import { TrialEntity } from './entities/trial.entity.js';
import { ExecutionModule } from './execution/execution.module.js';
import { ExperimentsModule } from './experiments/experiments.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TrialsModule } from './trials/trials.module.js';

/** Observability package helpers; `ObserveInstrument` is passed into NestFactory.create in main.ts. */
export const { ObserveModule, ObserveInstrument } = createObserveModule();

/** TypeORM entity classes = Postgres tables. Registered once at the root so all feature modules can inject repositories. */
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
    // forRootAsync + useFactory: delay connection setup until env vars are available.
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
    // BullMQ stores jobs in Redis. Feature modules register named queues (see TrialQueueModule).
    BullModule.forRootAsync({
      useFactory: () => ({ connection: redisConnection() }),
    }),
    // Feature modules: each owns a slice of the HTTP API and/or background work.
    TasksModule,
    ConfigsModule,
    ExperimentsModule,
    TrialsModule,
    ExecutionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
