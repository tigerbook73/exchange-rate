# 工商银行澳币汇率 PWA

展示工商银行澳大利亚元现汇卖出价（个人购汇价）、当日分时与每日历史。今日未发布报价时，显示最近有效报价日并标明日期。

Vite + React 前端和只读 API 部署到同一个 Cloudflare Worker；独立采集 Worker 每分钟获取现价，D1 保存权威数据。打开、刷新和唤醒 App 均不抓取源站，IndexedDB 与 Serwist 保留离线副本。

- [技术方案与数据契约](docs/blueprint.md)
- [开发约束](AGENTS.md)
- [阶段工作流](docs/phase-workflow.md)
- [运行状态、回退依据与待办](docs/operations.md)

## 本地运行

使用 Node.js 24、pnpm 11，依赖由 lockfile 锁定。

```bash
corepack pnpm@11 install --frozen-lockfile
pnpm db:migrate
pnpm db:check
pnpm db:demo
pnpm dev
```

打开 http://localhost:3000 。端口被占用时可用 `pnpm dev --port 3001`。开发服务通过 Cloudflare Vite 插件在真实 Workers 运行时执行 API，使用本地 D1，不连接生产；开发模式不注册 SW。

`db:demo` 仅为空库写入固定的一年历史和三日分时演示快照，不请求源站；演示库不能混入真实数据。需要真实本地数据时显式执行：

```bash
# 仅清理本地业务数据，不访问云端
pnpm db:reset
pnpm db:backfill
pnpm db:collect
pnpm collector:local
```

`db:backfill` 校准历史，`db:collect` 采一次现价；`collector:local` 立即采集一次，随后每分钟采集现价，Ctrl+C 停止。它不自动运行历史校准，也不模拟云端 Cron 的调度可靠性。

`pnpm collector:dev` 启动独立采集 Worker 的本地调试，端口 8787；通过 `/__scheduled` 显式触发，不会自行每分钟执行。线上没有公开采集端点。

`pnpm db:repair-gaps` 根据已有记录修复本地历史缺日，不请求源站、不推进历史确认游标；生产对应命令为 `pnpm db:repair-gaps:remote`。补缺语义见技术方案。

网站与管理脚本共用 `.wrangler/state/v3` 内的本地模拟库：Vite / Wrangler 的持久化根路径为 `.wrangler/state`，`getPlatformProxy` 使用 `.wrangler/state/v3`。该目录不纳入 Git。

## 构建与验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm exec wrangler deploy --dry-run --outdir .wrangler/website-check
node scripts/deploy-collector.mjs --dry-run --outdir .wrangler/collector-check
pnpm cf-typegen
```

类型检查覆盖浏览器、网站 Worker、SW、collector、Node 工具和测试；binding 类型从 Wrangler 配置生成。D1 集成测试使用隔离的临时本地数据库，需要回环端口权限。Chromium 页面测试 mock API，不请求源站；若自动启动服务受限，可先运行 `pnpm dev` 再测试。指定已有服务可用 `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm exec playwright test e2e/rate-page.spec.ts`。

构建输出为 `dist/client` 和 `dist/icbc_rate`；Wrangler 根据生成的部署配置发布产物。collector 独立构建，不受网站 CI 名称 / tag 覆盖。不要同时重建产物和运行依赖这些产物的生产预览测试。

PWA 需要生产模式验证：

```bash
pnpm preview
# 或复用已构建产物
pnpm exec vite preview --port 8788
```

打开 http://localhost:8788 ，先在线加载、等待 SW 接管，再在线重载一次，最后断网重载。可运行 `PLAYWRIGHT_BASE_URL=http://localhost:8788 pnpm exec playwright test e2e/pwa.spec.ts`；该用例在默认开发测试中跳过。普通离线或 503 不清空本地数据；API 协议不兼容时的一次刷新和兼容快照重建规则见技术方案。

## 正式部署

正式入口 https://icbc-rate.tigerbook.top ，网站 `icbc-rate`、采集 `icbc-rate-collector`、D1 `icbc-rate`。账号和资源 ID 在 Wrangler 配置中，collector 不开放公开访问。

```bash
# 生产结构升级前导出备份，文件保存在忽略目录
pnpm exec wrangler d1 export DB --remote --output .wrangler/backups/before-deploy.sql
pnpm run deploy
# 仅发布 collector，也会先迁移和检查数据
pnpm run deploy:collector
```

统一发布顺序：Vite 构建 → 远程 migration → Node.js 兼容 / 现价 / 历史校准及就绪检查 → collector → 网站。失败停止发布，不清库。正常 build / preview 不连接生产；直接用原始发布命令会绕过数据检查。`pnpm upload` 会上传版本，不是本地预览。

Cloudflare Builds 只在网站配置生产流水线：Build command 留空，Deploy command 为 `pnpm run deploy`，项目根目录运行，构建变量 `PNPM_VERSION=11`。构建令牌需目标账号 D1 写权限和两个 Worker 发布权限；collector 无需第二条流水线。预览分支不得使用生产发布命令。控制台实际设置与仍待核实事项见运行状态文档，不能把本地配置当作已修改控制台。

本地提交、Git 推送和 Cloudflare 发布是独立操作；`git push` 需要明确授权。旧框架 R2 桶保留供回退，新代码不使用它；不自动删除远程资源或历史部署。
