import { Module } from '../../framework.js';
import { DisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';

@Module({
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
