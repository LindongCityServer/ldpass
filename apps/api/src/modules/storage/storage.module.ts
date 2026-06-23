import { Module } from '@nestjs/common';
import { StorageMonitorService } from './storage-monitor.service.js';
import { StorageController } from './storage.controller.js';

@Module({
  controllers: [StorageController],
  providers: [StorageMonitorService],
})
export class StorageModule {}
