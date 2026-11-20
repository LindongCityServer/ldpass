import { Controller, Get, Header, Query, Req } from '../../framework.js';
import type { ApiRequestLike, ApiResponseLike } from '../../shared/auth/request-context.js';
import { QqConnectCallbackQueryDto, QqConnectStartQueryDto } from './dto.js';
import { QqConnectService, type QqConnectCallbackResult } from './qq-connect.service.js';
import { serializeExpiredQqConnectStateCookie } from './qq-connect-state.js';

/**
 * 只收集 Set-Cookie。
 *
 * 框架在控制器返回 Response 时会原样返回、不再合并 HeaderCollector 里的头，
 * 所以回调这种“既要写会话 Cookie 又要 302”的场景必须自己收集再拼到 Response 上。
 */
class CookieCollector implements ApiResponseLike {
  private readonly cookies: string[] = [];

  setHeader(name: string, value: string | string[]): void {
    if (name.toLowerCase() !== 'set-cookie') {
      return;
    }

    this.cookies.push(...(Array.isArray(value) ? value : [value]));
  }

  readCookies(): string[] {
    return [...this.cookies];
  }
}

@Controller('auth')
export class QqConnectController {
  constructor(private readonly qqConnectService: QqConnectService) {}

  @Get('qq/status')
  @Header('Cache-Control', 'no-store')
  readStatus() {
    return this.qqConnectService.readStatus();
  }

  @Get('qq/start')
  start(@Query() query: QqConnectStartQueryDto, @Req() request: ApiRequestLike) {
    const { authorizeUrl, stateCookie } = this.qqConnectService.createAuthorization(
      request,
      query.redirect,
    );

    return createRedirectResponse(authorizeUrl, [stateCookie]);
  }

  @Get('qq/callback')
  async completeCallback(
    @Query() query: QqConnectCallbackQueryDto,
    @Req() request: ApiRequestLike,
  ): Promise<Response> {
    const response = new CookieCollector();
    const result = await this.qqConnectService.completeAuthorization({
      request,
      response,
      ...(query.code ? { code: query.code } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(query.error ? { error: query.error } : {}),
    });

    return createRedirectResponse(readRedirectTarget(result), [
      ...response.readCookies(),
      // state 是一次性的，回调处理完立即失效，失败重试必须重新点登录。
      serializeExpiredQqConnectStateCookie(),
    ]);
  }
}

function readRedirectTarget(result: QqConnectCallbackResult): string {
  switch (result.kind) {
    case 'login':
      return result.redirectPath;
    case 'bound':
      return '/account?qq=bound';
    case 'unbound':
      return '/login?qq=unbound';
    case 'rejected':
      return `/login?qq=${result.reason}`;
  }
}

function createRedirectResponse(location: string, cookies: string[]): Response {
  const headers = new Headers();
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');

  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }

  return new Response(null, { status: 302, headers });
}
