/**
 * Example NestJS provider (service).
 *
 * `@Injectable()` marks a class that Nest can construct and inject into controllers
 * or other services. Controllers stay thin (HTTP only); services hold logic.
 * This one only backs the root hello route — domain logic is in TasksService,
 * ConfigsService, ExperimentsService, TrialExecutor, etc.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
