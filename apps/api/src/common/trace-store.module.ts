/**
 * Provides a shared TraceStore instance via Nest DI.
 *
 * `useFactory` builds the class with TRACE_DIR (or the repo default). Any module
 * that imports TraceStoreModule can inject `TraceStore` in a constructor.
 */
import { Module } from '@nestjs/common';
import { DEFAULT_TRACE_DIR, TraceStore } from './trace-store.js';

@Module({
  providers: [
    {
      provide: TraceStore,
      useFactory: () => new TraceStore(process.env.TRACE_DIR ?? DEFAULT_TRACE_DIR),
    },
  ],
  exports: [TraceStore],
})
export class TraceStoreModule {}
