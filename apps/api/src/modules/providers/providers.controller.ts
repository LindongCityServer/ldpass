import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ProviderAuthService } from '../../shared/auth/provider-auth.service.js';
import type { ApiRequestLike, ApiResponseLike } from '../../shared/auth/request-context.js';
import { ProviderLoginDto, RegisterProviderDto, SubmitProviderProfileChangeDto } from './dto.js';
import { ProvidersService } from './providers.service.js';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly providerAuth: ProviderAuthService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterProviderDto) {
    return this.providersService.register(dto);
  }

  @Post('auth/login')
  async login(
    @Body() dto: ProviderLoginDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const result = await this.providersService.login(dto);
    await this.providerAuth.createSession(result.providerAccount.id, request, response);

    return result;
  }

  @Get('auth/session')
  async session(@Req() request: ApiRequestLike) {
    return {
      providerAccount: await this.providerAuth.getCurrentProviderAccount(request),
    };
  }

  @Get('profile-change-requests')
  async listProfileChangeRequests(@Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providersService.listProfileChangeRequests(providerAccount);
  }

  @Post('profile-change-requests')
  async submitProfileChangeRequest(@Body() dto: SubmitProviderProfileChangeDto, @Req() request: ApiRequestLike) {
    const providerAccount = await this.providerAuth.requireActiveProvider(request);
    return this.providersService.submitProfileChangeRequest(providerAccount, dto);
  }

  @Post('auth/logout')
  async logout(@Req() request: ApiRequestLike, @Res({ passthrough: true }) response: ApiResponseLike) {
    await this.providerAuth.clearSession(request, response);

    return {
      ok: true,
    };
  }
}
