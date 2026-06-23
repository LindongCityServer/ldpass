import { Global, Module } from '@nestjs/common';
import { EVENT_BUS, InMemoryEventBus } from '@ldpass/event-bus';

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      useFactory: () => new InMemoryEventBus(),
    },
  ],
  exports: [EVENT_BUS],
})
export class EventBusModule {}
