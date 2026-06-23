import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { CardTemplateVariantsService } from './card-template-variants.service.js';
import { CardTemplateVariantsQueryDto, CreateCardTemplateVariantDto, UpdateCardTemplateVariantDto } from './dto.js';

@Controller()
export class CardTemplateVariantsController {
  constructor(
    private readonly variantsService: CardTemplateVariantsService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Get('card-template-variants')
  async listEnabledVariants(@Query() query: CardTemplateVariantsQueryDto) {
    return this.variantsService.listEnabledVariants(query);
  }

  @Get('admin/card-template-variants')
  async listAdminVariants(@Query() query: CardTemplateVariantsQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.variantsService.listAdminVariants(query);
  }

  @Post('admin/card-template-variants')
  async createVariant(@Body() dto: CreateCardTemplateVariantDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.variantsService.createVariant(dto, admin);
  }

  @Post('admin/card-template-variants/:variantId')
  async updateVariant(
    @Param('variantId') variantId: string,
    @Body() dto: UpdateCardTemplateVariantDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.variantsService.updateVariant(variantId, dto, admin);
  }

  @Post('admin/card-template-variants/:variantId/delete')
  async deleteVariant(@Param('variantId') variantId: string, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.variantsService.deleteVariant(variantId, admin);
  }
}
