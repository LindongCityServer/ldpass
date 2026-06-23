import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  CreateAddPassTokenDto,
  ListAddPassTokensQueryDto,
  ReissueAddPassTokenDto,
  RevokeAddPassTokenDto,
} from './add-pass-token.dto.js';
import { AddPassTokensService } from './add-pass-tokens.service.js';

@Controller('admin/add-pass-tokens')
export class AddPassTokensController {
  constructor(
    private readonly addPassTokensService: AddPassTokensService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Post()
  async createToken(@Body() dto: CreateAddPassTokenDto, @Req() request: ApiRequestLike) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.addPassTokensService.createToken(dto, admin);
  }

  @Get()
  async listTokens(@Query() query: ListAddPassTokensQueryDto, @Req() request: ApiRequestLike) {
    await this.sessionAuth.requireAdmin(request);
    return this.addPassTokensService.listTokens(query);
  }

  @Post(':tokenId/revoke')
  async revokeToken(
    @Param('tokenId') tokenId: string,
    @Body() dto: RevokeAddPassTokenDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.addPassTokensService.revokeToken(tokenId, dto, admin);
  }

  @Post(':tokenId/reissue')
  async reissueToken(
    @Param('tokenId') tokenId: string,
    @Body() dto: ReissueAddPassTokenDto,
    @Req() request: ApiRequestLike,
  ) {
    const admin = await this.sessionAuth.requireAdmin(request);
    return this.addPassTokensService.reissueToken(tokenId, dto, admin);
  }
}
