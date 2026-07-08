import { Module } from '../../framework.js';
import { PlatformStatusController } from './platform-status.controller.js';
import { PlatformStatusService } from './platform-status.service.js';

@Module({
  controllers: [PlatformStatusController],
  providers: [PlatformStatusService],
})
export class PlatformModule {}
