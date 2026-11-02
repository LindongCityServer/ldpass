const placeholderPattern = /replace-with|请替换|示例|changeme/i;
const minSecretLength = 16;

export type RequiredProductionSecretKey =
  | 'SESSION_SECRET'
  | 'PROVIDER_API_KEY_SECRET'
  | 'WEBHOOK_SECRET_ENCRYPTION_KEY'
  | 'PASSWORD_PEPPER'
  | 'PIN_PEPPER';

export const requiredProductionSecretKeys: RequiredProductionSecretKey[] = [
  'SESSION_SECRET',
  'PROVIDER_API_KEY_SECRET',
  'WEBHOOK_SECRET_ENCRYPTION_KEY',
  'PASSWORD_PEPPER',
  'PIN_PEPPER',
];

export function readSecretValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function isPlaceholderSecret(value: string): boolean {
  return placeholderPattern.test(value);
}

/**
 * 读取密码/PIN 的主 pepper。
 *
 * 生产环境不允许使用示例占位符，避免用公开字符串派生所有凭据哈希。
 */
export function readPrimaryPepper(name: 'PASSWORD_PEPPER' | 'PIN_PEPPER'): string {
  const value = readSecretValue(name);

  if (!value) {
    throw new Error(`缺少 ${name}，无法安全派生凭据哈希。`);
  }

  if (value.length < minSecretLength) {
    throw new Error(`${name} 长度不足 ${minSecretLength} 个字符，请改用随机长密钥。`);
  }

  if (process.env.NODE_ENV === 'production' && isPlaceholderSecret(value)) {
    throw new Error(`${name} 仍是示例占位符，请替换为随机长密钥后再启动生产环境。`);
  }

  return value;
}

export function collectProductionSecretProblems(): string[] {
  const problems: string[] = [];

  for (const key of requiredProductionSecretKeys) {
    const value = readSecretValue(key);

    if (!value) {
      problems.push(`${key} 未配置`);
      continue;
    }

    if (value.length < minSecretLength) {
      problems.push(`${key} 长度不足 ${minSecretLength} 个字符`);
      continue;
    }

    if (isPlaceholderSecret(value)) {
      problems.push(`${key} 仍是示例占位符`);
    }
  }

  return problems;
}

/**
 * 生产环境启动时校验密钥配置。
 *
 * 这里选择抛错而不是仅打印警告：占位符密钥意味着会话可被伪造、
 * 凭据哈希与密文可被离线破解，属于必须阻断的配置错误。
 */
export function assertProductionSecretConfiguration(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const problems = collectProductionSecretProblems();
  if (problems.length === 0) {
    return;
  }

  throw new Error(
    [
      '[ldpass] 生产环境密钥配置不安全，已拒绝启动：',
      ...problems.map((problem) => `- ${problem}`),
      '请为每个密钥生成独立的随机值，例如：',
      'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      '替换 pepper 前请先阅读 PASSWORD_PEPPER_LEGACY / PIN_PEPPER_LEGACY 的迁移说明。',
    ].join('\n'),
  );
}
