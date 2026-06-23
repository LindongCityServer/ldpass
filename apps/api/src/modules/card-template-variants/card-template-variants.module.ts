import { Module } from '@nestjs/common';
import { CardTemplateVariantsController } from './card-template-variants.controller.js';
import { CardTemplateVariantsService } from './card-template-variants.service.js';

@Module({
  controllers: [CardTemplateVariantsController],
  providers: [CardTemplateVariantsService],
})
export class CardTemplateVariantsModule {}
