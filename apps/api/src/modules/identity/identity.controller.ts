import { Body, Controller, Get, Options, Param, Post, Query, Req, Res } from '@nestjs/common';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike, ApiResponseLike } from '../../shared/auth/request-context.js';
import {
  AdminLoginDto,
  ClientSessionQueryDto,
  DeleteAccountDto,
  LoginRedirectQueryDto,
  LoginDto,
  RegisterReviewDto,
  RegisterServerStartDto,
  ResubmitReviewDto,
  SetPinDto,
  StartServerAccountRebindDto,
  UpdateAccountPreferencesDto,
} from './dto.js';
import { IdentityService } from './identity.service.js';

@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly sessionAuth: SessionAuthService,
  ) {}

  @Post('register/review')
  async registerForAdminReview(@Body() dto: RegisterReviewDto, @Req() request: ApiRequestLike) {
    const result = await this.identityService.registerForAdminReview(dto, request);

    return {
      ...result,
      nextAction: 'wait_for_admin_review',
    };
  }

  @Post('register/server/start')
  async startServerRegistration(@Body() dto: RegisterServerStartDto, @Req() request: ApiRequestLike) {
    const result = await this.identityService.startServerRegistration(dto, request);

    return {
      ...result,
      nextAction: 'send_code_in_server_chat',
    };
  }

  @Post('register/server/:challengeId/check')
  async checkServerRegistration(
    @Param('challengeId') challengeId: string,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const result = await this.identityService.checkServerRegistration(challengeId);
    if (result.status === 'verified' && result.sessionReady) {
      await this.sessionAuth.createSession(result.user.id, request, response);
    }

    return result;
  }

  @Get('login/redirect')
  async validateLoginRedirect(@Query() query: LoginRedirectQueryDto) {
    return this.identityService.validateLoginRedirect(query);
  }

  @Options('client-session')
  async clientSessionPreflight(
    @Query() query: ClientSessionQueryDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const access = await this.identityService.validateClientApplicationAccess(query, request);
    this.writeClientSessionCorsHeaders(response, access.allowedOrigin);

    return {
      ok: true,
    };
  }

  @Get('client-session')
  async clientSession(
    @Query() query: ClientSessionQueryDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const access = await this.identityService.validateClientApplicationAccess(query, request);
    this.writeClientSessionCorsHeaders(response, access.allowedOrigin);
    const user = await this.sessionAuth.getCurrentUser(request);

    return this.identityService.createClientSessionValidationResult(access, user);
  }

  @Post('login/device/:challengeId/check')
  async checkDeviceLoginVerification(
    @Param('challengeId') challengeId: string,
    @Body() dto: LoginDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const result = await this.identityService.checkDeviceLoginVerification(challengeId, dto, request);
    if (result.nextAction === 'authenticated' || result.nextAction === 'account_status') {
      await this.sessionAuth.createSession(result.user.id, request, response, result.device?.id);
    }

    return result;
  }

  @Post('login/device-approvals/:approvalId/check')
  async checkDeviceLoginApproval(
    @Param('approvalId') approvalId: string,
    @Body() dto: LoginDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const result = await this.identityService.checkDeviceLoginApproval(approvalId, dto, request);
    if (result.nextAction === 'authenticated') {
      await this.sessionAuth.createSession(result.user.id, request, response, result.device?.id);
    }

    return result;
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const result = await this.identityService.login(dto, request);
    if (result.nextAction === 'authenticated' || result.nextAction === 'account_status') {
      await this.sessionAuth.createSession(result.user.id, request, response, result.device?.id);
    }

    return result;
  }

  @Post('admin/login')
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const result = await this.identityService.adminLogin(dto, request);
    await this.sessionAuth.createSession(result.user.id, request, response, result.device?.id);

    return result;
  }

  @Get('session')
  async session(@Req() request: ApiRequestLike) {
    return {
      user: await this.sessionAuth.getCurrentUser(request),
    };
  }

  @Post('logout')
  async logout(@Req() request: ApiRequestLike, @Res({ passthrough: true }) response: ApiResponseLike) {
    await this.sessionAuth.clearSession(request, response);

    return {
      ok: true,
    };
  }

  @Post('account/delete')
  async deleteAccount(
    @Body() dto: DeleteAccountDto,
    @Req() request: ApiRequestLike,
    @Res({ passthrough: true }) response: ApiResponseLike,
  ) {
    const user = await this.sessionAuth.requireUser(request);
    const result = await this.identityService.deleteOwnAccount(user, dto.password);
    await this.sessionAuth.clearSession(request, response);

    return result;
  }

  @Post('account/review/resubmit')
  async resubmitReviewInfo(@Body() dto: ResubmitReviewDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireUser(request);
    return this.identityService.resubmitReviewInfo(user, dto, request);
  }

  @Post('account/pin')
  async setPin(@Body() dto: SetPinDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.setPin(user, dto.password, dto.pin);
  }

  @Post('account/server-account/rebind/start')
  async startServerAccountRebind(@Body() dto: StartServerAccountRebindDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    const result = await this.identityService.startServerAccountRebind(user, dto);

    return {
      ...result,
      nextAction: 'send_code_in_server_chat',
    };
  }

  @Post('account/server-account/rebind/:challengeId/check')
  async checkServerAccountRebind(@Param('challengeId') challengeId: string, @Req() request: ApiRequestLike) {
    const session = await this.sessionAuth.requireActiveSession(request);
    return this.identityService.checkServerAccountRebind(
      session.user,
      challengeId,
      session.sessionId,
      session.deviceId,
    );
  }

  @Post('account/preferences')
  async updateAccountPreferences(@Body() dto: UpdateAccountPreferencesDto, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.updateAccountPreferences(user, dto);
  }

  @Get('account/devices')
  async listDevices(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.listDevices(user);
  }

  @Get('account/device-login-approvals')
  async listDeviceLoginApprovals(@Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.listDeviceLoginApprovals(user);
  }

  @Post('account/device-login-approvals/:approvalId/approve')
  async approveDeviceLoginApproval(@Param('approvalId') approvalId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.approveDeviceLoginApproval(user, approvalId);
  }

  @Post('account/device-login-approvals/:approvalId/reject')
  async rejectDeviceLoginApproval(@Param('approvalId') approvalId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.rejectDeviceLoginApproval(user, approvalId);
  }

  @Post('account/devices/:deviceId/revoke')
  async revokeDevice(@Param('deviceId') deviceId: string, @Req() request: ApiRequestLike) {
    const user = await this.sessionAuth.requireActiveUser(request);
    return this.identityService.revokeDevice(user, deviceId);
  }

  private writeClientSessionCorsHeaders(response: ApiResponseLike, allowedOrigin: string | null): void {
    response.setHeader('Vary', 'Origin');

    if (!allowedOrigin) {
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
