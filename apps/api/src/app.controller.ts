/**
 * Root HTTP controller — NestJS "controller" pattern.
 *
 * `@Controller()` with no path prefix means routes are on `/`.
 * `@Get()` maps GET / to `getHello()`. Nest injects `AppService` via the constructor
 * (dependency injection): you declare the type, Nest creates/shares the instance.
 *
 * Real domain routes live under feature controllers: `/tasks`, `/configs`,
 * `/experiments`, `/trials`. This endpoint is just a health/hello stub.
 */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
