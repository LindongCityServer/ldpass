import type { DomainEvent, DomainEventType } from '@ldpass/contracts';

export type EventHandler<TEvent extends DomainEvent = DomainEvent> = (event: TEvent) => void | Promise<void>;

export interface EventBus {
  publish<TEvent extends DomainEvent>(event: TEvent): Promise<void>;
  subscribe<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<Extract<DomainEvent, { type: TType }>>,
  ): () => void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<DomainEventType, Set<EventHandler>>();

  async publish<TEvent extends DomainEvent>(event: TEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);

    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.all([...handlers].map((handler) => handler(event)));
  }

  subscribe<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<Extract<DomainEvent, { type: TType }>>,
  ): () => void {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.handlers.set(type, handlers);

    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    };
  }
}

export const EVENT_BUS = Symbol('LD_PASS_EVENT_BUS');
