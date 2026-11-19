import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '../../framework.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import {
  ClaimGroupQqLinkTokenDto,
  ConfirmQqLinkTokenDto,
  InspectQqLinkTokenQueryDto,
} from './dto.js';
import { QqLinksService } from './qq-links.service.js';

@Controller('account')
export class QqLinksController {
  constructor(
    private readonly qqLinksService: QqLinksService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Post('qq-link/code')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async createCode(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);

    return this.qqLinksService.issueCode(user, request);
  }

  @Get('qq-links')
  @Header('Cache-Control', 'no-store')
  async listLinks(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);

    return this.qqLinksService.listLinks(user);
  }

  @Delete('qq-links/:id')
  @Header('Cache-Control', 'no-store')
  async deleteLink(@Param('id') linkId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);

    return this.qqLinksService.revokeLink(user, linkId);
  }

  @Get('qq-link/token')
  @Header('Cache-Control', 'no-store')
  async inspectToken(@Query() query: InspectQqLinkTokenQueryDto) {
    return this.qqLinksService.inspectToken(query.token);
  }

  @Post('qq-link/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirmLink(@Body() dto: ConfirmQqLinkTokenDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);

    return this.qqLinksService.confirmToken(user, dto);
  }

  @Post('qq-link/group/claim')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async claimGroupLink(@Body() dto: ClaimGroupQqLinkTokenDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);

    return this.qqLinksService.claimGroupToken(user, dto);
  }
}
