import { Module } from '../../framework.js';
import { QqBotAuthService } from './qq-bot-auth.service.js';
import { QqBotLinkController } from './qq-bot-link.controller.js';
import { QqLinksController } from './qq-links.controller.js';
import { QqLinksService } from './qq-links.service.js';

@Module({
  controllers: [QqLinksController, QqBotLinkController],
  providers: [QqLinksService, QqBotAuthService],
  exports: [QqLinksService],
})
export class QqLinksModule {}
