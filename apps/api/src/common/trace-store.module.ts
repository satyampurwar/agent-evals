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
