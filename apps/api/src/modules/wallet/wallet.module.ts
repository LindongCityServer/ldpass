import { Module } from '@nestjs/common';
import { BdslmModule } from '../bdslm/bdslm.module.js';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [BdslmModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
