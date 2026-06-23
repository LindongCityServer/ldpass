import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { IssuingController } from './issuing.controller.js';
import { IssuingService } from './issuing.service.js';
import { OpenProviderIssuingController } from './open-provider-issuing.controller.js';

@Module({
  imports: [ProvidersModule],
  controllers: [IssuingController, OpenProviderIssuingController],
  providers: [IssuingService],
})
export class IssuingModule {}
