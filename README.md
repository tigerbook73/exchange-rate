# 工商银行澳币汇率 PWA

展示工商银行澳大利亚元现汇卖出价（个人购汇价）、当日分时与每日历史。今日报价尚未更新时，显示最近有效日并标明日期；服务端三日分时存储只作预备。目标平台为 Cloudflare Workers，保留 Next.js + OpenNext。

采集 Worker 主动获取并保存数据；网站 API 只读 D1。打开 App、刷新和返回前台不会触发源站抓取。App 使用 IndexedDB 和 Service Worker 保留离线能力。

- [技术方案](docs/blueprint.md)
- [开发约束](AGENTS.md)
- [阶段计划与验收](docs/plans/phase-1-cloudflare-server-rates.md)
- [当前实现进度](docs/progress/cloudflare-server-rates.md)

## 本地检查

使用 Node.js 24 和 pnpm 11 系列；依赖版本由 lockfile 锁定。

```bash
corepack pnpm@11 install --frozen-lockfile
pnpm db:migrate
pnpm db:check
pnpm db:demo
pnpm dev
```

打开 <http://localhost:3000>。`db:demo` 生成标明“本地演示数据”的一年每日历史和三日分时数据，不请求源站；该命令仅适用于空库，不覆盖已有数据。演示是固定快照，不会自行刷新价格。

实际 PWA 安装和断网重载请使用生产模式的本地预览：

```bash
pnpm preview
```

该命令先执行完整 OpenNext 构建，再启动本地 Wrangler，不会上传或部署。也可以指定端口，复用已构建产物：

```bash
pnpm exec opennextjs-cloudflare build
pnpm exec opennextjs-cloudflare preview --port 8788 --persist-to .wrangler/state
```

指定端口的预览打开 <http://localhost:8788>；直接运行 `pnpm preview` 时以终端显示的地址为准。先在线加载并等待 Service Worker 接管，再在线重载一次，然后断网重载。开发模式禁用 SW，不能用 `pnpm dev` 判断 PWA 离线启动是否正常。

## 本地真实数据

网页仍然只读数据库。需要真实报价时，通过独立命令主动采集：

```bash
# 仅在需要清空本地数据时执行，会删除本地演示或真实数据；不访问云端
pnpm db:reset
pnpm db:backfill
pnpm db:collect
```

`db:backfill` 初始化 / 校准每日历史，`db:collect` 采集一次当前报价。现价命令访问工商银行 JSON API，历史回填访问快易理财网。演示库拒绝混入真实数据，需先明确执行本地 reset。

持续本地采集：

```bash
pnpm collector:local
```

运行时立即采集一次，随后每分钟只采集现价，不自动校准历史；Ctrl+C 停止。它直接操作本地模拟 D1，不模拟云端 Cron 的触发可靠性。

`pnpm collector:dev` 用于独立采集 Worker 的 Wrangler 调试，提供本地 `http://localhost:8787/__scheduled` 测试入口；Wrangler dev 不会自行每分钟触发 Cron，持续本地采集应使用上面的 `collector:local`。线上 Worker 无公开采集端点。

网站、采集命令和 Wrangler 调试共用 `.wrangler/state/v3` 中的本地数据；CLI 的 `--persist-to` 参数用 `.wrangler/state`，`getPlatformProxy` 的路径用 `.wrangler/state/v3`，不能混淆。该目录被 Git 忽略。

## 检查命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm exec opennextjs-cloudflare build
pnpm exec wrangler deploy --config collector/wrangler.jsonc --dry-run --outdir .wrangler/collector-check
pnpm cf-typegen
```

类型检查包括主程序、WebWorker SW 与独立采集 Worker。Vitest 的数据库集成测试使用临时本地 D1，需要允许本地端口。Playwright 使用 Chromium，并 mock 查询 API；如果自动启动开发服务器卡住，先手动运行 `pnpm dev`。

可用 `PLAYWRIGHT_BASE_URL=http://localhost:8788 pnpm exec playwright test e2e/pwa.spec.ts` 验证生产预览的 SW 接管和断网重载。该用例在默认 dev 测试中跳过；API 使用 context routing mock，以涵盖 SW 发起的请求。

## Cloudflare 正式部署

用户已授权正式部署；生产入口为 <https://icbc-rate.tigerbook.top>，网站 Worker 为 `icbc-rate`，独立采集 Worker 为 `icbc-rate-collector`。生产 D1 为 `icbc-rate`；R2 桶 `icbc-rate-opennext-cache` 仅用于框架缓存。资源 ID 和账号写在两个 Wrangler 配置中。

本地默认仍使用模拟资源；`preview_database_id` 保留原本地库，`local-data.mjs` 显式禁用远程绑定。只有带 `:remote` 的管理命令会连接真实 D1，不提供远程 reset 命令。

```bash
# 现有生产库升级前先备份；首次空库初始化无需导入本地演示数据。
pnpm exec wrangler d1 migrations apply DB --remote
# 标准发布：构建后同步现价和历史，检查成功再发布两个 Worker。
pnpm run deploy
# 仅更新采集 Worker（也会先同步现价与历史、检查就绪）：
pnpm run deploy:collector
```

统一入口 `pnpm run deploy` 会先完成 OpenNext 构建，再应用远程 D1 migration、在本机 / CI 运行 `db:bootstrap:remote`，同步现价和历史、检查就绪，随后依次发布采集及网站 Worker；`pnpm run deploy:collector` 同样在发布前同步数据。历史同步失败或提交持续冲突会终止发布。

`db:bootstrap:remote` 使用已有历史游标增量校准，首次回溯一年，不清库。日常 Cron 只采现价并更新当日每日值、按既有规则清理过期分时 / 日志；长期不部署期间的历史漏采与校准要等下一次部署或显式回填。每日历史长期保留。直接调用原始 Wrangler / OpenNext 发布命令会绕过同步步骤，Cloudflare Builds 也应使用统一入口。网站 API 和 App 刷新均不触发采集。采集 Worker 不开放 workers.dev 或版本预览 URL。

`pnpm upload` 也会真正上传版本，不是本地预览。`git push` 仍需单独授权。Cloudflare Builds 的触发器读取曾返回 403，Vercel Git 自动部署也未在本次修改；下次推送前须在控制台核对并处理，避免旧 main 构建覆盖手工发布版本。

Cloudflare Workers Builds 只在网站 Worker `icbc-rate` 上配置一条生产流水线：

| 控制台字段     | 值                                         |
| -------------- | ------------------------------------------ |
| Build command  | 留空（统一部署脚本内已包含 OpenNext 构建） |
| Deploy command | `pnpm run deploy`                          |
| Root directory | 项目根目录                                 |
| 构建变量       | `PNPM_VERSION=11`                          |

`pnpm run deploy` 同时发布 `icbc-rate-collector` 和 `icbc-rate`，collector 不需要第二条 Git 自动部署流水线。采集发布子进程排除网站专属的 CI 名称 / tag 覆盖，避免 Wrangler 将采集代码错误发布到网站 Worker；网站子进程保留原 CI 目标校验。构建令牌必须有目标账号的 D1 写权限、两个 Worker 的发布权限及现有 R2 缓存访问权限。Cloudflare 自动生成的 Builds 令牌不一定包含 D1 权限，需核对。预览分支不能使用这个生产部署命令；本地 `pnpm preview` 不操作生产。设置应在新版脚本进入所选生产分支后使用；本地提交不等于已推送或已修改控制台。

Build command 可选，Deploy command 支持包管理器脚本，见 [Cloudflare 配置说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

本次部署验证、回退版本及仍需观察的 Cron CPU、D1/R2 用量和缓存命中见[进度文件](docs/progress/cloudflare-server-rates.md)。短时成功不等于完成两周稳定性观察。

官方现价 API 和部署前历史同步已于 2026-11-22 发布；版本、验收与运行观察见[进度文件](docs/progress/cloudflare-server-rates.md)。

## 版本升级

新客户端在 API 协议不兼容时自动整页刷新一次；刷新后接口兼容且快照校验成功，才清空并重建 App 本地数据及旧 API 缓存。断网、普通 503、报价更新不会触发清空。服务端历史与新版程序资源不受影响。未包含此机制的已安装旧版仍需先在线整页刷新一次。

D1 结构代次与必需字段只在显式本地检查和部署前检查，不在每次 API / Cron 中单独校验；实际读写错误仍按未就绪处理，不自动删库。统一发布入口执行迁移、兼容性及数据就绪检查后才发布；生产结构升级前仍应保留可恢复备份。无法迁移则显式建新库、恢复历史、验证并切换绑定。`db:reset` 只清理本地业务数据，不是云端结构重建工具。
