import { Module } from '@nestjs/common';
import { BdslmClientService } from './bdslm-client.service.js';

@Module({
  providers: [BdslmClientService],
  exports: [BdslmClientService],
})
export class BdslmModule {}
