import { Module } from '../../framework.js';
import { BdslmClientService } from './bdslm-client.service.js';

@Module({
  providers: [BdslmClientService],
  exports: [BdslmClientService],
})
export class BdslmModule {}
