# 临东通 LD Pass

临东通是一个类 Apple Wallet 体验的卡包管理网站，面向普通用户、卡券提供方和网站管理员。

当前仓库采用 TypeScript monorepo：

- `apps/web`：Next.js Web 应用。
- `apps/api`：NestJS API 应用。
- `packages/contracts`：共享事件、DTO、枚举和类型。
- `packages/database`：Prisma schema 与数据库入口。
- `packages/event-bus`：事件总线抽象。
- `packages/ui`：共享前端 UI 与品牌资源约定。

详细产品需求见 `docs/requirements.md`，阶段实现目标见 `docs/implementation-goals.md`，后台入口见 `docs/backoffice-login-guide.md`。

## 本地准备

1. 安装 Node.js LTS，保留随 Node.js 安装的 npm 即可。
2. 复制 `.env.example` 为 `.env`，按本地 SQLite 文件路径、端口和域名配置修改。
3. 执行 `npx --yes pnpm@10.14.0 install`。
4. 执行 `npx --yes pnpm@10.14.0 db:generate` 生成 Prisma Client。
5. 执行 `npx --yes pnpm@10.14.0 db:push` 创建或同步默认 SQLite 数据库。
6. 执行 `npx --yes pnpm@10.14.0 typecheck` 检查类型。

部署说明见 `docs/deployment-windows-bt.md`。
