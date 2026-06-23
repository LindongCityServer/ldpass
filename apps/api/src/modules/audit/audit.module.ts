import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditEventSubscriberService } from './audit-event-subscriber.service.js';
import { AuditQueryService } from './audit-query.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditEventSubscriberService, AuditQueryService],
})
export class AuditModule {}
