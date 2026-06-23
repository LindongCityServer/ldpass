import { Module } from '@nestjs/common';
import { PassTemplatesController } from './pass-templates.controller.js';
import { PassTemplatesService } from './pass-templates.service.js';

@Module({
  controllers: [PassTemplatesController],
  providers: [PassTemplatesService],
})
export class PassTemplatesModule {}
