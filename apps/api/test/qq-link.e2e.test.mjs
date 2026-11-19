import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');
const databaseDir = resolve(repoRoot, 'packages/database');
const prismaCli = resolve(databaseDir, 'node_modules/prisma/build/index.js');
const testTempDir = resolve(testDir, '.tmp');
const sqlitePath = join(testTempDir, `qq-link-e2e-${process.pid}-${Date.now()}.sqlite`);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:${sqlitePath.replaceAll('\\', '/')}`;
process.env.SESSION_SECRET = 'qq-link-e2e-session-secret-0123456789';
process.env.PASSWORD_PEPPER = 'qq-link-e2e-password-pepper-0123456789';
process.env.PIN_PEPPER = 'qq-link-e2e-pin-pepper-0123456789';
process.env.PROVIDER_API_KEY_SECRET = 'qq-link-e2e-provider-key-secret-0123456789';
process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'qq-link-e2e-webhook-secret-0123456789';
process.env.QQ_BOT_LINK_SECRET = 'qq-link-e2e-bot-secret-0123456789abcdef';
process.env.QQ_LINK_HASH_SECRET = 'qq-link-e2e-hash-secret-0123456789abcdef';
process.env.WEB_ORIGIN = 'https://ldpass.test';
process.env.TRUST_PROXY_HEADERS = 'true';

let prisma;
let handleNextApiRequest;
let shutdownNextApiApplication;
let resetQqLinkThrottle;
let nextConfig;
let userSequence = 0;

before(async () => {
  mkdirSync(testTempDir, { recursive: true });
  rmSync(sqlitePath, { force: true });

  execFileSync(process.execPath, [prismaCli, 'db', 'push'], {
    cwd: databaseDir,
    env: process.env,
    stdio: 'inherit',
  });

  const database = await import('@ldpass/database');
  const handlerModule = await import('../dist/next-handler.js');
  const throttleModule = await import('../dist/modules/qq-links/qq-link-throttle.js');
  const webConfigModule = await import('../../web/next.config.mjs');

  prisma = new database.PrismaClient(database.createPrismaClientOptions());
  handleNextApiRequest = handlerModule.handleNextApiRequest;
  shutdownNextApiApplication = handlerModule.shutdownNextApiApplication;
  resetQqLinkThrottle = throttleModule.resetQqLinkThrottle;
  nextConfig = webConfigModule.default;
});

beforeEach(() => {
  resetQqLinkThrottle();
});

after(async () => {
  await shutdownNextApiApplication?.().catch(() => undefined);
  await prisma?.$disconnect().catch(() => undefined);

  try {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      rmSync(`${sqlitePath}${suffix}`, { force: true });
    }
  } catch {
    // Windows 下 Prisma 连接关闭可能稍有延迟；.tmp 已加入 gitignore，不影响测试结果。
  }
});

describe('QQ 绑定码流程', () => {
  test('生成码 -> 消费 -> 绑定成功，网页列表不返回完整 openid', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-code-happy-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', {
      method: 'POST',
      cookie,
    });

    assert.equal(codeResponse.status, 200);
    assert.equal(codeResponse.headers.get('cache-control'), 'no-store');
    assert.match(codeResponse.body.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.ok(new Date(codeResponse.body.expiresAt).getTime() > Date.now());

    const codeRecord = await prisma.yctQqLinkCode.findFirst({
      where: { ldpassUserId: user.id, status: 'active' },
    });
    assert.ok(codeRecord);
    assert.ok(codeRecord.codeHash.length >= 64);
    assert.notEqual(codeRecord.codeHash, codeResponse.body.code);
    assert.notEqual(codeRecord.codeHash, codeResponse.body.code.replace('-', ''));

    const consumeResponse = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: {
        code: codeResponse.body.code,
        openId,
        scope: 'c2c',
        groupOpenId: null,
      },
    });

    assert.equal(consumeResponse.status, 200);
    assert.equal(consumeResponse.body.ok, true);
    assert.match(consumeResponse.body.link.id, /^qq_link_[a-f0-9]+$/);
    assert.equal(consumeResponse.body.link.ldpassUserId, user.id);
    assert.equal(consumeResponse.body.link.username, user.username);
    assert.equal(consumeResponse.body.link.scope, 'c2c');
    assert.ok(consumeResponse.body.link.createdAt);

    const linksResponse = await callApi('/api/account/qq-links', { cookie });
    assert.equal(linksResponse.status, 200);
    assert.equal(linksResponse.body.links.length, 1);
    assert.deepEqual(Object.keys(linksResponse.body.links[0]).sort(), [
      'createdAt',
      'groupOpenId',
      'id',
      'lastSeenAt',
      'scope',
    ]);
    assert.equal(linksResponse.body.links[0].groupOpenId, null);
    assert.ok(!JSON.stringify(linksResponse.body).includes(openId));

    const resolveResponse = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=c2c`,
    );
    assert.equal(resolveResponse.status, 200);
    assert.equal(resolveResponse.body.ok, true);
    assert.equal(resolveResponse.body.link.ldpassUserId, user.id);

    const [linkCount, codeAfter] = await Promise.all([
      prisma.yctQqLink.count({ where: { qqOpenId: openId, status: 'active' } }),
      prisma.yctQqLinkCode.findUnique({ where: { id: codeRecord.id } }),
    ]);
    assert.equal(linkCount, 1);
    assert.equal(codeAfter.status, 'used');
    assert.ok(codeAfter.usedAt);
    assert.equal(codeAfter.activeUserId, null);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        eventType: {
          in: ['QqLinkCodeIssued', 'QqLinkCodeConsumeSucceeded'],
        },
        OR: [{ actorId: user.id }, { subjectId: consumeResponse.body.link.id }],
      },
    });
    assert.equal(auditLogs.length, 2);
  });

  test('过期码返回 code_expired，且不会创建绑定', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-code-expired-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    await prisma.yctQqLinkCode.updateMany({
      where: { ldpassUserId: user.id, status: 'active' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const consumeResponse = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: codeResponse.body.code, openId, scope: 'c2c', groupOpenId: null },
    });

    assert.equal(consumeResponse.status, 400);
    assert.equal(consumeResponse.body.ok, false);
    assert.equal(consumeResponse.body.error, 'code_expired');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);
  });

  test('同一绑定码重复消费返回 code_used；同一 openid 换新码消费返回现有绑定', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-code-idempotent-${randomPart()}`;

    const firstCode = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const firstConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: firstCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(firstConsume.status, 200);

    const repeatedConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: firstCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(repeatedConsume.status, 409);
    assert.equal(repeatedConsume.body.error, 'code_used');

    const secondCode = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const secondConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: secondCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });

    assert.equal(secondConsume.status, 200);
    assert.equal(secondConsume.body.link.id, firstConsume.body.link.id);
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 1);
  });

  test('同一 openid 绑定第二个账号返回 openid_already_linked，且不消费新码', async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const firstCookie = await createSession(firstUser.id);
    const secondCookie = await createSession(secondUser.id);
    const openId = `openid-code-conflict-${randomPart()}`;

    const firstCode = await callApi('/api/account/qq-link/code', {
      method: 'POST',
      cookie: firstCookie,
    });
    const firstConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: firstCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(firstConsume.status, 200);

    const secondCode = await callApi('/api/account/qq-link/code', {
      method: 'POST',
      cookie: secondCookie,
    });
    const secondConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: secondCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });

    assert.equal(secondConsume.status, 409);
    assert.equal(secondConsume.body.error, 'openid_already_linked');
    assert.equal(await prisma.yctQqLink.count({ where: { ldpassUserId: secondUser.id } }), 0);

    const secondCodeRecord = await prisma.yctQqLinkCode.findFirst({
      where: { ldpassUserId: secondUser.id, status: 'active' },
    });
    assert.ok(secondCodeRecord);
  });

  test('未登录不能生成绑定码、查看绑定或解绑', async () => {
    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST' });
    assert.equal(codeResponse.status, 401);

    const listResponse = await callApi('/api/account/qq-links');
    assert.equal(listResponse.status, 401);

    const deleteResponse = await callApi('/api/account/qq-links/qq_link_test', {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 401);

    const confirmResponse = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      body: { token: 'x'.repeat(22) },
    });
    assert.equal(confirmResponse.status, 401);
  });

  test('错误 secret 不能调用内部接口', async () => {
    const wrongHeaders = { authorization: 'Bearer definitely-wrong-secret-value' };
    const body = { code: 'AAAA-BBBB', openId: `openid-secret-${randomPart()}`, scope: 'c2c' };

    const responses = await Promise.all([
      callApi('/api/internal/qq-link/consume', { method: 'POST', headers: wrongHeaders, body }),
      callApi(`/api/internal/qq-link/resolve?openId=${encodeURIComponent(body.openId)}&scope=c2c`, {
        headers: wrongHeaders,
      }),
      callApi('/api/internal/qq-link/unlink', { method: 'POST', headers: wrongHeaders, body }),
      callApi('/api/internal/qq-link/token', { method: 'POST', headers: wrongHeaders, body }),
    ]);

    for (const response of responses) {
      assert.equal(response.status, 401);
    }
  });

  test('解绑后 resolve 返回 null，账户列表为空', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-unlink-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const consumeResponse = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: codeResponse.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(consumeResponse.status, 200);

    const unlinkResponse = await callBot('/api/internal/qq-link/unlink', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(unlinkResponse.status, 200);
    assert.deepEqual(unlinkResponse.body, { ok: true });

    const resolveResponse = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=c2c`,
    );
    assert.equal(resolveResponse.status, 200);
    assert.deepEqual(resolveResponse.body, { ok: true, link: null });

    const linksResponse = await callApi('/api/account/qq-links', { cookie });
    assert.deepEqual(linksResponse.body.links, []);

    const revokedLink = await prisma.yctQqLink.findFirst({ where: { qqOpenId: openId } });
    assert.equal(revokedLink.status, 'revoked');
    assert.equal(revokedLink.activeKey, null);
    assert.equal(revokedLink.activeOpenIdKey, null);
  });

  test('解绑后可以用同一 openid 重新绑定', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-rebind-${randomPart()}`;

    const firstCode = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const firstConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: firstCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(firstConsume.status, 200);

    const unlinkResponse = await callBot('/api/internal/qq-link/unlink', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(unlinkResponse.status, 200);

    const secondCode = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const secondConsume = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: secondCode.body.code, openId, scope: 'c2c', groupOpenId: null },
    });

    assert.equal(secondConsume.status, 200);
    assert.notEqual(secondConsume.body.link.id, firstConsume.body.link.id);
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 2);
    assert.equal(
      await prisma.yctQqLink.count({ where: { qqOpenId: openId, status: 'active' } }),
      1,
    );
  });

  test('网页解绑校验记录归属并写审计事件', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const ownerCookie = await createSession(owner.id);
    const otherCookie = await createSession(otherUser.id);
    const openId = `openid-web-unlink-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', {
      method: 'POST',
      cookie: ownerCookie,
    });
    const consumeResponse = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: codeResponse.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    const linkId = consumeResponse.body.link.id;

    const foreignDelete = await callApi(`/api/account/qq-links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
      cookie: otherCookie,
    });
    assert.equal(foreignDelete.status, 404);

    const ownerDelete = await callApi(`/api/account/qq-links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
      cookie: ownerCookie,
    });
    assert.equal(ownerDelete.status, 200);
    assert.deepEqual(ownerDelete.body, { ok: true });

    const linksAfter = await callApi('/api/account/qq-links', { cookie: ownerCookie });
    assert.deepEqual(linksAfter.body.links, []);

    const audit = await prisma.auditLog.findFirst({
      where: {
        eventType: 'QqLinkRevoked',
        actorId: owner.id,
        subjectId: linkId,
      },
    });
    assert.ok(audit);
  });

  test('并发消费同一绑定码只允许一个成功', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-concurrent-${randomPart()}`;
    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });

    const payload = {
      method: 'POST',
      body: { code: codeResponse.body.code, openId, scope: 'c2c', groupOpenId: null },
    };
    const responses = await Promise.all([
      callBot('/api/internal/qq-link/consume', payload),
      callBot('/api/internal/qq-link/consume', payload),
    ]);
    const statuses = responses
      .map((response) => response.status)
      .sort((left, right) => left - right);

    assert.deepEqual(statuses, [200, 409]);
    const failed = responses.find((response) => response.status === 409);
    assert.equal(failed.body.error, 'code_used');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 1);
  });

  test('数据库唯一约束阻止重复 active 绑定与重复 active 绑定码', async () => {
    const user = await createUser();
    const openId = `openid-unique-${randomPart()}`;
    const now = new Date();

    await prisma.yctQqLink.create({
      data: {
        id: `qq_link_${randomBytes(12).toString('hex')}`,
        ldpassUserId: user.id,
        qqOpenId: openId,
        qqScope: 'c2c',
        groupOpenId: null,
        status: 'active',
        activeKey: `c2c:${openId}`,
        activeOpenIdKey: openId,
        createdAt: now,
        updatedAt: now,
      },
    });

    await assert.rejects(
      prisma.yctQqLink.create({
        data: {
          id: `qq_link_${randomBytes(12).toString('hex')}`,
          ldpassUserId: user.id,
          qqOpenId: openId,
          qqScope: 'c2c',
          groupOpenId: null,
          status: 'active',
          activeKey: `c2c:${openId}`,
          activeOpenIdKey: openId,
          createdAt: now,
          updatedAt: now,
        },
      }),
      (error) => error?.code === 'P2002',
    );

    const firstCodeHash = createHmac('sha256', process.env.QQ_LINK_HASH_SECRET)
      .update(`qq-link-code:AAAAAAAA`)
      .digest('hex');
    const secondCodeHash = createHmac('sha256', process.env.QQ_LINK_HASH_SECRET)
      .update(`qq-link-code:BBBBBBBB`)
      .digest('hex');

    await prisma.yctQqLinkCode.create({
      data: {
        ldpassUserId: user.id,
        codeHash: firstCodeHash,
        status: 'active',
        activeUserId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await assert.rejects(
      prisma.yctQqLinkCode.create({
        data: {
          ldpassUserId: user.id,
          codeHash: secondCodeHash,
          status: 'active',
          activeUserId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      (error) => error?.code === 'P2002',
    );
  });

  test('审计事件不包含明文绑定码和完整 openid', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-audit-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const code = codeResponse.body.code;
    const normalizedCode = code.replace('-', '');

    await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code, openId, scope: 'c2c', groupOpenId: null },
    });

    await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: 'ZZZZ-ZZZZ', openId, scope: 'c2c', groupOpenId: null },
    });

    const logs = await prisma.auditLog.findMany({
      where: {
        eventType: {
          in: ['QqLinkCodeIssued', 'QqLinkCodeConsumeSucceeded', 'QqLinkCodeConsumeFailed'],
        },
      },
    });

    assert.ok(logs.length >= 3);
    const serialized = JSON.stringify(logs);
    assert.ok(!serialized.includes(code));
    assert.ok(!serialized.includes(normalizedCode));
    assert.ok(!serialized.includes(openId));
    assert.ok(serialized.includes('QqLinkCodeConsumeFailed'));
  });

  test('群聊 scope 不生成绑定码消费、不创建绑定', async () => {
    const openId = `openid-group-${randomPart()}`;

    const response = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: {
        code: 'AAAA-BBBB',
        openId,
        scope: 'group',
        groupOpenId: `group-${randomPart()}`,
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'group_not_supported');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);
  });

  test('c2c scope 携带 groupOpenId 被拒绝，且不消费绑定码', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-c2c-with-group-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const response = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: {
        code: codeResponse.body.code,
        openId,
        scope: 'c2c',
        groupOpenId: `group-${randomPart()}`,
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'invalid_request');
    assert.ok(
      await prisma.yctQqLinkCode.findFirst({
        where: { ldpassUserId: user.id, status: 'active' },
      }),
    );
  });

  test('群聊携带有效绑定码也不消费，随后私聊仍可使用', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-group-valid-code-${randomPart()}`;
    const groupOpenId = `group-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
    const groupAttempt = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: {
        code: codeResponse.body.code,
        openId,
        scope: 'group',
        groupOpenId,
      },
    });

    assert.equal(groupAttempt.status, 400);
    assert.equal(groupAttempt.body.error, 'group_not_supported');

    const codeAfterGroupAttempt = await prisma.yctQqLinkCode.findFirst({
      where: { ldpassUserId: user.id, status: 'active' },
    });
    assert.ok(codeAfterGroupAttempt);

    const privateChatAttempt = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: {
        code: codeResponse.body.code,
        openId,
        scope: 'c2c',
        groupOpenId: null,
      },
    });

    assert.equal(privateChatAttempt.status, 200);
    assert.equal(privateChatAttempt.body.ok, true);
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 1);
  });

  test('消费失败按 openid 限流并返回 rate_limited', async () => {
    const openId = `openid-ratelimit-${randomPart()}`;
    const payload = {
      method: 'POST',
      body: { code: 'AAAA-BBBB', openId, scope: 'c2c', groupOpenId: null },
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await callBot('/api/internal/qq-link/consume', payload);
      assert.equal(response.body.error, 'code_invalid');
    }

    const limited = await callBot('/api/internal/qq-link/consume', payload);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
  });
});

describe('QQ 网页一次性 token 流程', () => {
  test('机器人生成 token -> 网页预览 -> 登录后确认绑定', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-token-happy-${randomPart()}`;

    const tokenResponse = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId: null },
    });

    assert.equal(tokenResponse.status, 200);
    assert.equal(tokenResponse.body.ok, true);
    assert.ok(tokenResponse.body.url.startsWith('https://ldpass.test/account/link/qq?token='));

    const tokenUrl = new URL(tokenResponse.body.url);
    const token = tokenUrl.searchParams.get('token');
    assert.ok(token);
    assert.equal(token.length, 22);

    const tokenRecord = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: openId },
    });
    assert.ok(tokenRecord);
    assert.notEqual(tokenRecord.tokenHash, token);

    const previewResponse = await callApi(
      `/api/account/qq-link/token?token=${encodeURIComponent(token)}`,
    );
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.body.ok, true);
    assert.equal(previewResponse.body.token.scope, 'c2c');
    assert.ok(!JSON.stringify(previewResponse.body).includes(openId));

    const unauthenticatedConfirm = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      body: { token },
    });
    assert.equal(unauthenticatedConfirm.status, 401);

    const confirmResponse = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      cookie,
      body: { token },
    });
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmResponse.body.ok, true);
    assert.match(confirmResponse.body.link.id, /^qq_link_[a-f0-9]+$/);
    assert.equal(confirmResponse.body.link.scope, 'c2c');

    const repeatedConfirm = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      cookie,
      body: { token },
    });
    assert.equal(repeatedConfirm.status, 409);
    assert.equal(repeatedConfirm.body.error, 'token_used');

    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 1);

    const tokenAfter = await prisma.yctQqLinkToken.findUnique({ where: { id: tokenRecord.id } });
    assert.equal(tokenAfter.status, 'used');
    assert.equal(tokenAfter.consumedByUserId, user.id);
  });

  test('过期 token 返回 token_expired', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `openid-token-expired-${randomPart()}`;

    const tokenResponse = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId: null },
    });
    const token = new URL(tokenResponse.body.url).searchParams.get('token');
    await prisma.yctQqLinkToken.updateMany({
      where: { qqOpenId: openId, status: 'active' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const previewResponse = await callApi(
      `/api/account/qq-link/token?token=${encodeURIComponent(token)}`,
    );
    assert.equal(previewResponse.status, 400);
    assert.equal(previewResponse.body.error, 'token_expired');

    const confirmResponse = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      cookie,
      body: { token },
    });
    assert.equal(confirmResponse.status, 400);
    assert.equal(confirmResponse.body.error, 'token_expired');
  });

  test('群聊生成 scope=group 的 token，并绑定 groupOpenId', async () => {
    const openId = `member-openid-token-group-${randomPart()}`;
    const groupOpenId = `group-openid-token-${randomPart()}`;

    const response = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'group', groupOpenId },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.ok(response.body.url.startsWith('https://ldpass.test/account/link/qq?token='));

    const token = new URL(response.body.url).searchParams.get('token');
    assert.ok(token);

    const record = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: openId, qqScope: 'group' },
    });
    assert.ok(record);
    assert.equal(record.groupOpenId, groupOpenId);
    assert.equal(record.status, 'active');
    assert.equal(record.claimedByUserId, null);
    assert.notEqual(record.tokenHash, token);

    const missingGroup = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'group', groupOpenId: null },
    });
    assert.equal(missingGroup.status, 400);
    assert.equal(missingGroup.body.error, 'invalid_request');

    const c2cWithGroup = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId },
    });
    assert.equal(c2cWithGroup.status, 400);
    assert.equal(c2cWithGroup.body.error, 'invalid_request');
  });

  test('openid 已绑定其他账号时，token 确认返回 openid_already_linked', async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const firstCookie = await createSession(firstUser.id);
    const secondCookie = await createSession(secondUser.id);
    const openId = `openid-token-conflict-${randomPart()}`;

    const codeResponse = await callApi('/api/account/qq-link/code', {
      method: 'POST',
      cookie: firstCookie,
    });
    const consumeResponse = await callBot('/api/internal/qq-link/consume', {
      method: 'POST',
      body: { code: codeResponse.body.code, openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(consumeResponse.status, 200);

    const tokenResponse = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId: null },
    });
    const token = new URL(tokenResponse.body.url).searchParams.get('token');

    const confirmResponse = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      cookie: secondCookie,
      body: { token },
    });

    assert.equal(confirmResponse.status, 409);
    assert.equal(confirmResponse.body.error, 'openid_already_linked');
    assert.equal(await prisma.yctQqLink.count({ where: { ldpassUserId: secondUser.id } }), 0);
  });

  test('绑定 token 页面与登录页配置了 no-referrer，账户接口配置了 no-store', async () => {
    const headerRules = await nextConfig.headers();
    const linkRule = headerRules.find((rule) => rule.source === '/account/link/qq');
    const loginRule = headerRules.find((rule) => rule.source === '/login');
    const accountApiRule = headerRules.find(
      (rule) => rule.source === '/api/account/qq-link/:path*',
    );

    assert.ok(linkRule);
    assert.ok(
      linkRule.headers.some(
        (header) => header.key === 'Referrer-Policy' && header.value === 'no-referrer',
      ),
    );
    assert.ok(
      linkRule.headers.some(
        (header) => header.key === 'Cache-Control' && header.value === 'no-store',
      ),
    );
    assert.ok(
      loginRule?.headers.some(
        (header) => header.key === 'Referrer-Policy' && header.value === 'no-referrer',
      ),
    );
    assert.ok(
      loginRule?.headers.some(
        (header) => header.key === 'Cache-Control' && header.value === 'no-store',
      ),
    );
    assert.ok(accountApiRule);
    assert.ok(
      accountApiRule.headers.some(
        (header) => header.key === 'Cache-Control' && header.value === 'no-store',
      ),
    );
  });
});

describe('QQ 群聊绑定流程', () => {
  test('群 token 生成 -> 网页预览/认领 -> 群内确认 -> 绑定成功', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-happy-${randomPart()}`;
    const groupOpenId = `group-openid-happy-${randomPart()}`;
    const { token } = await createGroupToken(openId, groupOpenId);

    const preview = await callApi(`/api/account/qq-link/token?token=${encodeURIComponent(token)}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.ok, true);
    assert.equal(preview.body.token.scope, 'group');
    assert.equal(preview.body.token.requiresGroupConfirmation, true);
    assert.ok(!JSON.stringify(preview.body).includes(openId));
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);

    const anonymousClaim = await callApi('/api/account/qq-link/group/claim', {
      method: 'POST',
      body: { token },
    });
    assert.equal(anonymousClaim.status, 401);

    const claim = await claimGroupToken(token, cookie);
    assert.equal(claim.status, 200);
    assert.equal(claim.body.ok, true);
    assert.equal(claim.body.scope, 'group');
    assert.match(claim.body.confirmCode, /^\d{6}$/);
    assert.ok(new Date(claim.body.expiresAt).getTime() > Date.now());

    const tokenRecord = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: openId, qqScope: 'group' },
    });
    assert.ok(tokenRecord);
    assert.equal(tokenRecord.status, 'active');
    assert.equal(tokenRecord.claimedByUserId, user.id);
    assert.ok(tokenRecord.claimedAt);
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);

    const repeatedClaim = await claimGroupToken(token, cookie);
    assert.equal(repeatedClaim.status, 200);
    assert.equal(repeatedClaim.body.confirmCode, claim.body.confirmCode);

    const confirmed = await confirmGroupLink({
      token,
      openId,
      groupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.ok, true);
    assert.match(confirmed.body.link.id, /^qq_link_[a-f0-9]+$/);
    assert.equal(confirmed.body.link.ldpassUserId, user.id);
    assert.equal(confirmed.body.link.username, user.username);
    assert.equal(confirmed.body.link.scope, 'group');
    assert.equal(confirmed.body.link.groupOpenId, groupOpenId);
    assert.ok(confirmed.body.link.createdAt);

    const linkRow = await prisma.yctQqLink.findFirst({
      where: { qqOpenId: openId, status: 'active' },
    });
    assert.ok(linkRow);
    assert.equal(linkRow.qqScope, 'group');
    assert.equal(linkRow.groupOpenId, groupOpenId);
    assert.equal(linkRow.activeKey, `group:${groupOpenId}:${openId}`);
    assert.equal(linkRow.activeOpenIdKey, null);

    const tokenAfter = await prisma.yctQqLinkToken.findUnique({ where: { id: tokenRecord.id } });
    assert.equal(tokenAfter.status, 'used');
    assert.equal(tokenAfter.consumedByUserId, user.id);
    assert.ok(tokenAfter.usedAt);

    const resolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=group&groupOpenId=${encodeURIComponent(groupOpenId)}`,
    );
    assert.equal(resolve.status, 200);
    assert.equal(resolve.body.link.id, linkRow.id);
    assert.equal(resolve.body.link.scope, 'group');
    assert.equal(resolve.body.link.groupOpenId, groupOpenId);

    const c2cResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=c2c`,
    );
    assert.deepEqual(c2cResolve.body, { ok: true, link: null });

    const linksResponse = await callApi('/api/account/qq-links', { cookie });
    assert.equal(linksResponse.body.links.length, 1);
    assert.equal(linksResponse.body.links[0].scope, 'group');
    assert.equal(
      linksResponse.body.links[0].groupOpenId,
      `${groupOpenId.slice(0, 4)}…${groupOpenId.slice(-4)}`,
    );
    assert.ok(!JSON.stringify(linksResponse.body).includes(groupOpenId));
  });

  test('错误群、错误 openid、群管理员都不能确认，且 token 不会被消费', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-mismatch-${randomPart()}`;
    const groupOpenId = `group-openid-mismatch-${randomPart()}`;
    const otherGroupOpenId = `group-openid-other-${randomPart()}`;
    const groupOwnerOpenId = `member-openid-owner-${randomPart()}`;
    const { token } = await createGroupToken(openId, groupOpenId);
    const claim = await claimGroupToken(token, cookie);
    assert.equal(claim.status, 200);

    const wrongGroup = await confirmGroupLink({
      token,
      openId,
      groupOpenId: otherGroupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(wrongGroup.status, 400);
    assert.equal(wrongGroup.body.ok, false);
    assert.equal(wrongGroup.body.error, 'group_mismatch');

    // 群主/管理员也是普通 member_openid，不能替发起绑定的成员确认。
    const wrongOpenId = await confirmGroupLink({
      token,
      openId: groupOwnerOpenId,
      groupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(wrongOpenId.status, 400);
    assert.equal(wrongOpenId.body.error, 'openid_mismatch');

    const tokenAfterFailures = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: openId, qqScope: 'group' },
    });
    assert.equal(tokenAfterFailures.status, 'active');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);

    const confirmed = await confirmGroupLink({
      token,
      openId,
      groupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.link.ldpassUserId, user.id);
  });

  test('群里其他人打开链接不能完成绑定，也不能覆盖认领', async () => {
    const victim = await createUser();
    const attacker = await createUser();
    const victimCookie = await createSession(victim.id);
    const attackerCookie = await createSession(attacker.id);
    const victimOpenId = `member-openid-victim-${randomPart()}`;
    const attackerOpenId = `member-openid-attacker-${randomPart()}`;
    const groupOpenId = `group-openid-shared-${randomPart()}`;
    const { token } = await createGroupToken(victimOpenId, groupOpenId);

    const attackerClaim = await claimGroupToken(token, attackerCookie);
    assert.equal(attackerClaim.status, 200);
    assert.equal(attackerClaim.body.scope, 'group');

    const victimClaim = await claimGroupToken(token, victimCookie);
    assert.equal(victimClaim.status, 409);
    assert.equal(victimClaim.body.error, 'token_claimed');

    const attackerConfirm = await confirmGroupLink({
      token,
      openId: attackerOpenId,
      groupOpenId,
      code: attackerClaim.body.confirmCode,
    });
    assert.equal(attackerConfirm.status, 400);
    assert.equal(attackerConfirm.body.error, 'openid_mismatch');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: victimOpenId } }), 0);

    const webConfirm = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      cookie: victimCookie,
      body: { token },
    });
    assert.equal(webConfirm.status, 400);
    assert.equal(webConfirm.body.error, 'group_confirm_required');

    const tokenAfter = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: victimOpenId, qqScope: 'group' },
    });
    assert.equal(tokenAfter.status, 'active');
    assert.equal(tokenAfter.claimedByUserId, attacker.id);

    const fresh = await createGroupToken(victimOpenId, groupOpenId);
    const freshClaim = await claimGroupToken(fresh.token, victimCookie);
    assert.equal(freshClaim.status, 200);
    const confirmed = await confirmGroupLink({
      token: fresh.token,
      openId: victimOpenId,
      groupOpenId,
      code: freshClaim.body.confirmCode,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.link.ldpassUserId, victim.id);
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: victimOpenId } }), 1);
  });

  test('确认码错误不消费；未认领、过期、重复使用返回明确错误码', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-code-${randomPart()}`;
    const groupOpenId = `group-openid-code-${randomPart()}`;
    const { token } = await createGroupToken(openId, groupOpenId);
    const claim = await claimGroupToken(token, cookie);
    assert.equal(claim.status, 200);

    const wrongCode = claim.body.confirmCode === '000000' ? '000001' : '000000';
    const wrong = await confirmGroupLink({ token, openId, groupOpenId, code: wrongCode });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'confirm_code_invalid');

    const shortCode = await confirmGroupLink({ token, openId, groupOpenId, code: '12345' });
    assert.equal(shortCode.status, 400);
    assert.equal(shortCode.body.error, 'confirm_code_invalid');

    const tokenAfterWrongCodes = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: openId, qqScope: 'group' },
    });
    assert.equal(tokenAfterWrongCodes.status, 'active');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);

    const confirmed = await confirmGroupLink({
      token,
      openId,
      groupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(confirmed.status, 200);

    const reused = await confirmGroupLink({
      token,
      openId,
      groupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error, 'token_used');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 1);

    const expiredOpenId = `member-openid-expired-${randomPart()}`;
    const expiredGroupOpenId = `group-openid-expired-${randomPart()}`;
    const expiredToken = await createGroupToken(expiredOpenId, expiredGroupOpenId);
    const expiredClaim = await claimGroupToken(expiredToken.token, cookie);
    assert.equal(expiredClaim.status, 200);
    await prisma.yctQqLinkToken.updateMany({
      where: { qqOpenId: expiredOpenId, status: 'active' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expired = await confirmGroupLink({
      token: expiredToken.token,
      openId: expiredOpenId,
      groupOpenId: expiredGroupOpenId,
      code: expiredClaim.body.confirmCode,
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error, 'token_expired');

    const expiredPreview = await callApi(
      `/api/account/qq-link/token?token=${encodeURIComponent(expiredToken.token)}`,
    );
    assert.equal(expiredPreview.status, 400);
    assert.equal(expiredPreview.body.error, 'token_expired');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: expiredOpenId } }), 0);

    const unclaimedOpenId = `member-openid-unclaimed-${randomPart()}`;
    const unclaimedGroupOpenId = `group-openid-unclaimed-${randomPart()}`;
    const unclaimed = await createGroupToken(unclaimedOpenId, unclaimedGroupOpenId);
    const unclaimedConfirm = await confirmGroupLink({
      token: unclaimed.token,
      openId: unclaimedOpenId,
      groupOpenId: unclaimedGroupOpenId,
      code: '123456',
    });
    assert.equal(unclaimedConfirm.status, 400);
    assert.equal(unclaimedConfirm.body.error, 'token_not_claimed');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: unclaimedOpenId } }), 0);
  });

  test('群绑定与单聊绑定互相独立，同一账号可以有多个群身份', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-independent-${randomPart()}`;
    const firstGroupOpenId = `group-openid-first-${randomPart()}`;
    const secondGroupOpenId = `group-openid-second-${randomPart()}`;

    const c2cLink = await bindC2cLink(cookie, openId);
    assert.equal(c2cLink.scope, 'c2c');

    const firstGroupLink = await bindGroupLink({ cookie, openId, groupOpenId: firstGroupOpenId });
    const secondGroupLink = await bindGroupLink({
      cookie,
      openId,
      groupOpenId: secondGroupOpenId,
    });

    assert.notEqual(firstGroupLink.id, c2cLink.id);
    assert.notEqual(secondGroupLink.id, firstGroupLink.id);

    const activeLinks = await prisma.yctQqLink.findMany({
      where: { qqOpenId: openId, status: 'active' },
    });
    assert.equal(activeLinks.length, 3);
    assert.deepEqual(
      new Set(activeLinks.map((link) => `${link.qqScope}:${link.groupOpenId ?? ''}`)),
      new Set(['c2c:', `group:${firstGroupOpenId}`, `group:${secondGroupOpenId}`]),
    );

    const c2cResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=c2c`,
    );
    assert.equal(c2cResolve.body.link.id, c2cLink.id);
    assert.equal(c2cResolve.body.link.scope, 'c2c');

    const groupResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=group&groupOpenId=${encodeURIComponent(secondGroupOpenId)}`,
    );
    assert.equal(groupResolve.body.link.id, secondGroupLink.id);
    assert.equal(groupResolve.body.link.scope, 'group');

    const linksResponse = await callApi('/api/account/qq-links', { cookie });
    assert.equal(linksResponse.body.links.length, 3);

    // 同一个 openid 仍然不能绑定到第二个临东通账号。
    const otherUser = await createUser();
    const otherCookie = await createSession(otherUser.id);
    const otherGroupOpenId = `group-openid-other-account-${randomPart()}`;
    const otherToken = await createGroupToken(openId, otherGroupOpenId);
    const otherClaim = await claimGroupToken(otherToken.token, otherCookie);
    assert.equal(otherClaim.status, 200);
    const otherConfirm = await confirmGroupLink({
      token: otherToken.token,
      openId,
      groupOpenId: otherGroupOpenId,
      code: otherClaim.body.confirmCode,
    });
    assert.equal(otherConfirm.status, 409);
    assert.equal(otherConfirm.body.error, 'openid_already_linked');
    assert.equal(
      await prisma.yctQqLink.count({
        where: { qqOpenId: openId, groupOpenId: otherGroupOpenId },
      }),
      0,
    );
    const otherTokenAfter = await prisma.yctQqLinkToken.findUnique({
      where: { id: otherToken.recordId },
    });
    assert.equal(otherTokenAfter.status, 'active');
  });

  test('resolve 按 group 查询，缺少 groupOpenId 或 c2c 携带 groupOpenId 都拒绝', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const firstOpenId = `member-openid-resolve-a-${randomPart()}`;
    const secondOpenId = `member-openid-resolve-b-${randomPart()}`;
    const firstGroupOpenId = `group-openid-resolve-a-${randomPart()}`;
    const secondGroupOpenId = `group-openid-resolve-b-${randomPart()}`;

    const firstLink = await bindGroupLink({
      cookie,
      openId: firstOpenId,
      groupOpenId: firstGroupOpenId,
    });
    const secondLink = await bindGroupLink({
      cookie,
      openId: secondOpenId,
      groupOpenId: secondGroupOpenId,
    });

    const firstResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(firstOpenId)}&scope=group&groupOpenId=${encodeURIComponent(firstGroupOpenId)}`,
    );
    assert.equal(firstResolve.status, 200);
    assert.equal(firstResolve.body.link.id, firstLink.id);
    assert.equal(firstResolve.body.link.groupOpenId, firstGroupOpenId);

    const secondResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(secondOpenId)}&scope=group&groupOpenId=${encodeURIComponent(secondGroupOpenId)}`,
    );
    assert.equal(secondResolve.body.link.id, secondLink.id);

    const unknownGroup = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(firstOpenId)}&scope=group&groupOpenId=${encodeURIComponent(`group-openid-unknown-${randomPart()}`)}`,
    );
    assert.equal(unknownGroup.status, 200);
    assert.deepEqual(unknownGroup.body, { ok: true, link: null });

    const missingGroup = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(firstOpenId)}&scope=group`,
    );
    assert.equal(missingGroup.status, 400);
    assert.equal(missingGroup.body.error, 'invalid_request');

    const c2cWithGroup = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(firstOpenId)}&scope=c2c&groupOpenId=${encodeURIComponent(firstGroupOpenId)}`,
    );
    assert.equal(c2cWithGroup.status, 400);
    assert.equal(c2cWithGroup.body.error, 'invalid_request');

    const updated = await prisma.yctQqLink.findUnique({ where: { id: firstLink.id } });
    assert.ok(updated.lastSeenAt);
  });

  test('群解绑只解绑当前群身份，不影响其他群和单聊绑定', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-unlink-${randomPart()}`;
    const firstGroupOpenId = `group-openid-unlink-a-${randomPart()}`;
    const secondGroupOpenId = `group-openid-unlink-b-${randomPart()}`;
    const c2cOpenId = `openid-unlink-c2c-${randomPart()}`;

    const c2cLink = await bindC2cLink(cookie, c2cOpenId);
    const firstGroupLink = await bindGroupLink({
      cookie,
      openId,
      groupOpenId: firstGroupOpenId,
    });
    const secondGroupLink = await bindGroupLink({
      cookie,
      openId,
      groupOpenId: secondGroupOpenId,
    });

    const wrongGroupUnlink = await callBot('/api/internal/qq-link/unlink', {
      method: 'POST',
      body: {
        openId,
        scope: 'group',
        groupOpenId: `group-openid-unlink-wrong-${randomPart()}`,
      },
    });
    assert.equal(wrongGroupUnlink.status, 200);
    assert.deepEqual(wrongGroupUnlink.body, { ok: true });

    const firstUnlink = await callBot('/api/internal/qq-link/unlink', {
      method: 'POST',
      body: { openId, scope: 'group', groupOpenId: firstGroupOpenId },
    });
    assert.equal(firstUnlink.status, 200);
    assert.deepEqual(firstUnlink.body, { ok: true });

    const firstAfter = await prisma.yctQqLink.findUnique({ where: { id: firstGroupLink.id } });
    assert.equal(firstAfter.status, 'revoked');
    assert.equal(firstAfter.activeKey, null);
    assert.equal(firstAfter.qqOpenId, openId);
    assert.equal(firstAfter.groupOpenId, firstGroupOpenId);

    const secondAfter = await prisma.yctQqLink.findUnique({ where: { id: secondGroupLink.id } });
    assert.equal(secondAfter.status, 'active');
    const c2cAfter = await prisma.yctQqLink.findUnique({ where: { id: c2cLink.id } });
    assert.equal(c2cAfter.status, 'active');

    const removedResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=group&groupOpenId=${encodeURIComponent(firstGroupOpenId)}`,
    );
    assert.deepEqual(removedResolve.body, { ok: true, link: null });
    const keptResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(openId)}&scope=group&groupOpenId=${encodeURIComponent(secondGroupOpenId)}`,
    );
    assert.equal(keptResolve.body.link.id, secondGroupLink.id);
    const keptC2cResolve = await callBot(
      `/api/internal/qq-link/resolve?openId=${encodeURIComponent(c2cOpenId)}&scope=c2c`,
    );
    assert.equal(keptC2cResolve.body.link.id, c2cLink.id);

    const webRevoke = await callApi(
      `/api/account/qq-links/${encodeURIComponent(secondGroupLink.id)}`,
      { method: 'DELETE', cookie },
    );
    assert.equal(webRevoke.status, 200);
    const secondAfterWeb = await prisma.yctQqLink.findUnique({
      where: { id: secondGroupLink.id },
    });
    assert.equal(secondAfterWeb.status, 'revoked');
    assert.equal(
      (await prisma.yctQqLink.findUnique({ where: { id: c2cLink.id } })).status,
      'active',
    );

    // 解绑后同一个群身份可以重新绑定，且会生成新的绑定记录。
    const rebound = await bindGroupLink({
      cookie,
      openId,
      groupOpenId: firstGroupOpenId,
    });
    assert.notEqual(rebound.id, firstGroupLink.id);
    assert.equal(rebound.scope, 'group');
    assert.equal(
      await prisma.yctQqLink.count({
        where: { qqOpenId: openId, groupOpenId: firstGroupOpenId, status: 'active' },
      }),
      1,
    );
  });

  test('并发确认同一个群 token 只允许一个成功', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-concurrent-group-${randomPart()}`;
    const groupOpenId = `group-openid-concurrent-${randomPart()}`;
    const { token } = await createGroupToken(openId, groupOpenId);
    const claim = await claimGroupToken(token, cookie);
    assert.equal(claim.status, 200);

    const payload = {
      token,
      openId,
      groupOpenId,
      code: claim.body.confirmCode,
    };
    const responses = await Promise.all([confirmGroupLink(payload), confirmGroupLink(payload)]);
    const statuses = responses
      .map((response) => response.status)
      .sort((left, right) => left - right);
    assert.deepEqual(statuses, [200, 409]);

    const failed = responses.find((response) => response.status === 409);
    assert.equal(failed.body.error, 'token_used');
    assert.equal(
      await prisma.yctQqLink.count({ where: { qqOpenId: openId, qqScope: 'group' } }),
      1,
    );
    const tokenAfter = await prisma.yctQqLinkToken.findFirst({
      where: { qqOpenId: openId, qqScope: 'group' },
    });
    assert.equal(tokenAfter.status, 'used');
  });

  test('群绑定审计不包含明文 token、确认码和完整 openid', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-audit-group-${randomPart()}`;
    const groupOpenId = `group-openid-audit-${randomPart()}`;
    const { token } = await createGroupToken(openId, groupOpenId);
    const claim = await claimGroupToken(token, cookie);
    assert.equal(claim.status, 200);

    const wrongCode = claim.body.confirmCode === '000000' ? '000001' : '000000';
    await confirmGroupLink({ token, openId, groupOpenId, code: wrongCode });
    const confirmed = await confirmGroupLink({
      token,
      openId,
      groupOpenId,
      code: claim.body.confirmCode,
    });
    assert.equal(confirmed.status, 200);
    await callBot('/api/internal/qq-link/unlink', {
      method: 'POST',
      body: { openId, scope: 'group', groupOpenId },
    });

    const logs = await prisma.auditLog.findMany({
      where: {
        eventType: {
          in: [
            'QqLinkTokenIssued',
            'QqLinkTokenClaimed',
            'QqLinkGroupConfirmSucceeded',
            'QqLinkGroupConfirmFailed',
            'QqLinkRevoked',
          ],
        },
      },
    });
    assert.ok(logs.length >= 5);

    const serialized = JSON.stringify(logs);
    assert.ok(!serialized.includes(token));
    assert.ok(!serialized.includes(claim.body.confirmCode));
    assert.ok(!serialized.includes(openId));
    assert.ok(!serialized.includes(groupOpenId));
    assert.ok(serialized.includes('QqLinkTokenClaimed'));
    assert.ok(serialized.includes('QqLinkGroupConfirmSucceeded'));
    assert.ok(serialized.includes('QqLinkGroupConfirmFailed'));
  });

  test('scope 隔离：群 token 不能在网页确认，单聊 token 不能群确认', async () => {
    const user = await createUser();
    const cookie = await createSession(user.id);
    const openId = `member-openid-scope-${randomPart()}`;
    const groupOpenId = `group-openid-scope-${randomPart()}`;

    const groupToken = await createGroupToken(openId, groupOpenId);
    const groupClaim = await claimGroupToken(groupToken.token, cookie);
    assert.equal(groupClaim.status, 200);

    const webConfirm = await callApi('/api/account/qq-link/confirm', {
      method: 'POST',
      cookie,
      body: { token: groupToken.token },
    });
    assert.equal(webConfirm.status, 400);
    assert.equal(webConfirm.body.error, 'group_confirm_required');
    const groupTokenAfter = await prisma.yctQqLinkToken.findUnique({
      where: { id: groupToken.recordId },
    });
    assert.equal(groupTokenAfter.status, 'active');
    assert.equal(await prisma.yctQqLink.count({ where: { qqOpenId: openId } }), 0);

    const c2cTokenResponse = await callBot('/api/internal/qq-link/token', {
      method: 'POST',
      body: { openId, scope: 'c2c', groupOpenId: null },
    });
    assert.equal(c2cTokenResponse.status, 200);
    const c2cToken = new URL(c2cTokenResponse.body.url).searchParams.get('token');
    assert.ok(c2cToken);

    const wrongScopeConfirm = await confirmGroupLink({
      token: c2cToken,
      openId,
      groupOpenId,
      code: groupClaim.body.confirmCode,
    });
    assert.equal(wrongScopeConfirm.status, 400);
    assert.equal(wrongScopeConfirm.body.error, 'group_mismatch');

    const wrongScopeClaim = await claimGroupToken(c2cToken, cookie);
    assert.equal(wrongScopeClaim.status, 400);
    assert.equal(wrongScopeClaim.body.error, 'group_mismatch');
  });
});

async function createUser(status = 'Active') {
  userSequence += 1;
  const suffix = `${Date.now().toString(36)}${userSequence}`;

  return prisma.user.create({
    data: {
      username: `qq_${suffix}`,
      email: `qq_${suffix}@example.test`,
      passwordHash: 'test-password-hash',
      status,
    },
  });
}

async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHmac('sha256', process.env.SESSION_SECRET)
    .update(token)
    .digest('base64url');

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return `ldpass_session=${encodeURIComponent(token)}`;
}

async function createGroupToken(openId, groupOpenId) {
  const response = await callBot('/api/internal/qq-link/token', {
    method: 'POST',
    body: { openId, scope: 'group', groupOpenId },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);

  const token = new URL(response.body.url).searchParams.get('token');
  assert.ok(token);

  const tokenHash = createHmac('sha256', process.env.QQ_LINK_HASH_SECRET)
    .update(`qq-link-token:${token}`)
    .digest('hex');
  const record = await prisma.yctQqLinkToken.findUnique({ where: { tokenHash } });
  assert.ok(record);
  assert.equal(record.qqScope, 'group');
  assert.equal(record.groupOpenId, groupOpenId);
  assert.equal(record.qqOpenId, openId);

  return { token, recordId: record.id, expiresAt: response.body.expiresAt };
}

function claimGroupToken(token, cookie) {
  return callApi('/api/account/qq-link/group/claim', {
    method: 'POST',
    cookie,
    body: { token },
  });
}

function confirmGroupLink({ token, openId, groupOpenId, code }) {
  return callBot('/api/internal/qq-link/confirm-group', {
    method: 'POST',
    body: { token, openId, groupOpenId, code },
  });
}

async function bindGroupLink({ cookie, openId, groupOpenId }) {
  const { token } = await createGroupToken(openId, groupOpenId);
  const claim = await claimGroupToken(token, cookie);
  assert.equal(claim.status, 200);
  assert.equal(claim.body.ok, true);

  const confirm = await confirmGroupLink({
    token,
    openId,
    groupOpenId,
    code: claim.body.confirmCode,
  });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.ok, true);

  return confirm.body.link;
}

async function bindC2cLink(cookie, openId) {
  const codeResponse = await callApi('/api/account/qq-link/code', { method: 'POST', cookie });
  assert.equal(codeResponse.status, 200);

  const consumeResponse = await callBot('/api/internal/qq-link/consume', {
    method: 'POST',
    body: { code: codeResponse.body.code, openId, scope: 'c2c', groupOpenId: null },
  });
  assert.equal(consumeResponse.status, 200);
  assert.equal(consumeResponse.body.ok, true);

  return consumeResponse.body.link;
}

function botHeaders(overrides = {}) {
  return {
    authorization: `Bearer ${process.env.QQ_BOT_LINK_SECRET}`,
    ...overrides,
  };
}

function callBot(path, options = {}) {
  return callApi(path, {
    ...options,
    headers: botHeaders(options.headers),
  });
}

async function callApi(path, options = {}) {
  const method = options.method ?? 'GET';
  const url = new URL(path, 'http://localhost');
  const headers = new Headers(options.headers);

  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }

  if (options.clientIp) {
    headers.set('x-forwarded-for', options.clientIp);
  }

  let body;

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const request = new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
  const pathSegments = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const response = await handleNextApiRequest(request, pathSegments);
  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

function randomPart() {
  return randomBytes(8).toString('hex');
}
