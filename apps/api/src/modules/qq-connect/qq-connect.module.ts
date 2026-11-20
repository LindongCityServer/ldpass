import { Module } from '../../framework.js';
import { QqConnectController } from './qq-connect.controller.js';
import { QqConnectService } from './qq-connect.service.js';

@Module({
  controllers: [QqConnectController],
  providers: [QqConnectService],
})
export class QqConnectModule {}
