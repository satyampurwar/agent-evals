/**
 * Nest "pipe" that validates request data with Zod.
 *
 * Pipes run before the controller method. Nest's `PipeTransform` interface is just
 * `transform(value)`. Here we call `schema.safeParse`; on failure we throw
 * `BadRequestException` with Zod's issue list (becomes HTTP 400 JSON).
 *
 * Zod (from `@agent-evals/domain`) is the single source of truth for request shapes
 * like ConfigInput / ExperimentInput / TaskImport — TypeScript types are inferred
 * from those schemas (`z.infer<typeof Schema>`).
 */
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/** The subset of a zod schema this pipe needs. Any zod schema satisfies it structurally. */
export interface SafeParseSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown[] } };
}

/**
 * Validates a request body or param with a zod schema and returns the parsed value.
 * Unknown keys are stripped by zod's default object behaviour, so server-assigned fields
 * cannot be injected by clients when the schema does not declare them.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: SafeParseSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
