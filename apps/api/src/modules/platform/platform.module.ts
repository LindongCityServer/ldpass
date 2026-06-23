import { Module } from '@nestjs/common';
import { PlatformStatusController } from './platform-status.controller.js';
import { PlatformStatusService } from './platform-status.service.js';

@Module({
  controllers: [PlatformStatusController],
  providers: [PlatformStatusService],
})
export class PlatformModule {}
