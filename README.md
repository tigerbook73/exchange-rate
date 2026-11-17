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

### Cloudflare 的 GitHub 自动部署

在 Cloudflare 后台进入 **Workers & Pages → icbc-rate → Settings → Builds → Connect**，授权 Cloudflare GitHub App 访问 `tigerbook73/exchange-rate`，并设置：

| 设置     | 值                                       |
| -------- | ---------------------------------------- |
| 生产分支 | `main`                                   |
| 根目录   | `/`（仓库根目录）                        |
| 构建命令 | `pnpm exec opennextjs-cloudflare build`  |
| 部署命令 | `pnpm exec opennextjs-cloudflare deploy` |

构建和部署拆开执行，避免部署阶段再次构建；Worker 名称必须与 `wrangler.jsonc` 的 `name`（`icbc-rate`）一致。保存后，推送到 GitHub 的 `main` 分支才会触发自动部署，本地 commit 不会触发。配置是否成功以后台连接状态和首次构建日志为准。

Wrangler 登录成功不代表具备管理自动构建的权限。若通过 API 配置，还需要用户级 API token 的 `Workers Builds Configuration: Edit` 权限，以及 Cloudflare GitHub App 授权和部署用 build token；不要将令牌写入仓库或聊天。详见 [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) 和 [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)。
