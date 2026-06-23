import { Module } from '@nestjs/common';
import { BdslmModule } from '../bdslm/bdslm.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { ActionLinkExpirySweeperService } from './action-link-expiry-sweeper.service.js';
import { ActionLinksController } from './action-links.controller.js';
import { ActionLinksService } from './action-links.service.js';

@Module({
  imports: [BdslmModule, ProvidersModule],
  controllers: [ActionLinksController],
  providers: [ActionLinksService, ActionLinkExpirySweeperService],
})
export class ActionLinksModule {}
