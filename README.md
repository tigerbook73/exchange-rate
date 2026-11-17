# 工商银行澳币汇率 PWA

展示中国工商银行「澳大利亚元」现汇卖出价（购汇价）的当日报价与历史趋势，纯客户端存储，无后端持久化。

- 技术方案：[`docs/blueprint.md`](./docs/blueprint.md)
- Agent 协作约束与迭代工作流：[`AGENTS.md`](./AGENTS.md)
- 分阶段开发流程：[`docs/phase-workflow.md`](./docs/phase-workflow.md)

## 开发

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 常用脚本

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm format        # Prettier 写入
pnpm format:check  # Prettier 检查
pnpm test          # vitest run
pnpm build         # next build
```

## 部署

同一份源码支持 Vercel 和 Cloudflare Workers，两套部署分别执行：

- **Vercel**：使用标准 Next.js 构建命令 `pnpm build`，不要设置为 `pnpm deploy`。如果在 Vercel 后台连接了 GitHub 仓库，推送到配置的生产分支后会触发自动部署。
- **Cloudflare Workers**：在本地完成 `pnpm exec wrangler login` 后，运行 `pnpm deploy`，通过 OpenNext 构建并发布到 `wrangler.jsonc` 配置的 Worker。`pnpm preview` 用于本地预览 Worker。

Cloudflare 本地运行时只在 `pnpm dev` 的开发阶段初始化；两边的生产构建都不会启动它。`open-next.config.ts`、`wrangler.jsonc` 和 `public/_headers` 供 Cloudflare 使用，Vercel 无需配置 Cloudflare 登录凭据或绑定。

`pnpm deploy` 不会推送 GitHub，也不会发布到 Vercel。是否在推送 GitHub 后同时触发两边部署，取决于各平台后台的 Git 集成设置。
