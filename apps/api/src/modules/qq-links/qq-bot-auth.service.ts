import { Injectable, ServiceUnavailableException, UnauthorizedException } from '../../framework.js';
import { isPlaceholderSecret } from '../../shared/auth/secret-config.js';
import { readHeader, type ApiRequestLike } from '../../shared/auth/request-context.js';
import { safeEqualText } from './qq-link-crypto.js';

const minSecretLength = 24;

/**
 * 机器人内部接口只接受 Authorization: Bearer <QQ_BOT_LINK_SECRET>。
 *
 * 该密钥与会话、API Key、webhook 密钥完全独立；未配置时失败关闭（503），
 * 不会退化为匿名可调用。错误响应不包含密钥内容或长度等细节。
 */
@Injectable()
export class QqBotAuthService {
  requireAuthorized(request: ApiRequestLike): void {
    const secret = process.env.QQ_BOT_LINK_SECRET?.trim();

    if (!secret || secret.length < minSecretLength) {
      throw new ServiceUnavailableException(
        `QQ 绑定内部接口未正确配置，请设置至少 ${minSecretLength} 位的 QQ_BOT_LINK_SECRET。`,
      );
    }

    if (process.env.NODE_ENV === 'production' && isPlaceholderSecret(secret)) {
      throw new ServiceUnavailableException(
        'QQ_BOT_LINK_SECRET 仍是示例占位符，请替换为独立的随机密钥。',
      );
    }

    const authorization = readHeader(request, 'authorization')?.trim();
    const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
    const providedSecret = match?.[1]?.trim();

    if (!providedSecret) {
      throw new UnauthorizedException('缺少 QQ 机器人内部接口认证信息。');
    }

    if (!safeEqualText(providedSecret, secret)) {
      throw new UnauthorizedException('QQ 机器人内部接口密钥无效。');
    }
  }
}
