import { Module } from '../../framework.js';
import { CardTemplateVariantsController } from './card-template-variants.controller.js';
import { CardTemplateVariantsService } from './card-template-variants.service.js';

@Module({
  controllers: [CardTemplateVariantsController],
  providers: [CardTemplateVariantsService],
})
export class CardTemplateVariantsModule {}
