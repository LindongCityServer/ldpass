import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '../../framework.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  ConfirmGroupQqLinkTokenDto,
  ConsumeQqLinkCodeDto,
  IssueQqLinkTokenDto,
  ResolveQqLinkQueryDto,
  UnlinkQqLinkDto,
} from './dto.js';
import { QqBotAuthService } from './qq-bot-auth.service.js';
import { QqLinksService } from './qq-links.service.js';

@Controller('internal/qq-link')
export class QqBotLinkController {
  constructor(
    private readonly qqLinksService: QqLinksService,
    private readonly qqBotAuth: QqBotAuthService,
  ) {}

  @Post('consume')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async consumeCode(@Body() dto: ConsumeQqLinkCodeDto, @Req() request: ApiRequestLike) {
    this.qqBotAuth.requireAuthorized(request);

    return this.qqLinksService.consumeCode(dto);
  }

  @Get('resolve')
  @Header('Cache-Control', 'no-store')
  async resolveLink(@Query() query: ResolveQqLinkQueryDto, @Req() request: ApiRequestLike) {
    this.qqBotAuth.requireAuthorized(request);

    return this.qqLinksService.resolveLink(query);
  }

  @Post('unlink')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async unlink(@Body() dto: UnlinkQqLinkDto, @Req() request: ApiRequestLike) {
    this.qqBotAuth.requireAuthorized(request);

    return this.qqLinksService.unlinkByBot(dto);
  }

  @Post('token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async issueToken(@Body() dto: IssueQqLinkTokenDto, @Req() request: ApiRequestLike) {
    this.qqBotAuth.requireAuthorized(request);

    return this.qqLinksService.issueToken(dto, request);
  }

  @Post('confirm-group')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirmGroup(@Body() dto: ConfirmGroupQqLinkTokenDto, @Req() request: ApiRequestLike) {
    this.qqBotAuth.requireAuthorized(request);

    return this.qqLinksService.confirmGroupToken(dto);
  }
}
