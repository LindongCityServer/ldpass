import { HttpException, HttpStatus } from '../../framework.js';
import type { YctQqLinkFailureReason } from '@ldpass/contracts';

const statusByReason: Record<YctQqLinkFailureReason, number> = {
  code_invalid: HttpStatus.BAD_REQUEST,
  code_expired: HttpStatus.BAD_REQUEST,
  code_used: HttpStatus.CONFLICT,
  openid_already_linked: HttpStatus.CONFLICT,
  link_conflict: HttpStatus.CONFLICT,
  group_not_supported: HttpStatus.BAD_REQUEST,
  group_mismatch: HttpStatus.BAD_REQUEST,
  openid_mismatch: HttpStatus.BAD_REQUEST,
  confirm_code_invalid: HttpStatus.BAD_REQUEST,
  group_confirm_required: HttpStatus.BAD_REQUEST,
  token_not_claimed: HttpStatus.BAD_REQUEST,
  token_claimed: HttpStatus.CONFLICT,
  account_inactive: HttpStatus.FORBIDDEN,
  invalid_request: HttpStatus.BAD_REQUEST,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  token_invalid: HttpStatus.BAD_REQUEST,
  token_expired: HttpStatus.BAD_REQUEST,
  token_used: HttpStatus.CONFLICT,
  not_linked: HttpStatus.NOT_FOUND,
};

export function createQqLinkErrorBody(
  reason: YctQqLinkFailureReason,
  message: string,
): Record<string, unknown> {
  return {
    ok: false,
    error: reason,
    message,
  };
}

/**
 * 抛出契约约定的 { ok:false, error, message }，同时保留合适的 HTTP 状态码，
 * 让网页端可以读取 message，机器人端可以按 error 分支处理。
 */
export function throwQqLinkError(reason: YctQqLinkFailureReason, message: string): never {
  throw new HttpException(createQqLinkErrorBody(reason, message), statusByReason[reason]);
}
