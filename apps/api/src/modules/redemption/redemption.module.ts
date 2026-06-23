import { Module } from '@nestjs/common';
import { BdslmModule } from '../bdslm/bdslm.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { OpenProviderRedemptionController } from './open-provider-redemption.controller.js';
import { RedemptionController } from './redemption.controller.js';
import { RedemptionService } from './redemption.service.js';

@Module({
  imports: [BdslmModule, ProvidersModule],
  controllers: [RedemptionController, OpenProviderRedemptionController],
  providers: [RedemptionService],
})
export class RedemptionModule {}
