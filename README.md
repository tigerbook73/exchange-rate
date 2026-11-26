# 工商银行澳币汇率 PWA

供少数人私人使用，展示澳元现汇卖出价、分时与每日历史。优先保持开发和操作简单，可接受短暂不可用或数据延迟；部署目标为 Cloudflare Free，仍重视 Worker CPU 效率和免费额度适配。

Vite + React 与只读 API 共用网站 Worker；独立 Cron 每分钟采集，D1 保存数据，IndexedDB / Serwist 提供离线副本。

[开发约定](AGENTS.md) · [数据与 API 规则](docs/blueprint.md) · [运维备忘](docs/operations.md)

## 本地开发

Node.js 24、pnpm 11：

```bash
corepack pnpm@11 install --frozen-lockfile
pnpm db:migrate
pnpm db:check
pnpm db:demo
pnpm dev
```

打开 http://localhost:3000 ，换端口可用 `pnpm dev --port 3001`。开发模式使用本地 D1，不注册 SW。演示初始化只写空库，不请求源站；本地数据在忽略目录 `.wrangler/state/`，管理脚本与开发服务共用该库。

需要真实本地数据时，用以下命令替代演示数据；`db:reset` **会删除本地业务数据**，不访问生产：

```bash
pnpm db:reset
pnpm db:backfill       # 抓取并校准历史
pnpm collector:local   # 立即采一次，此后每分钟采集，Ctrl+C 停止
```

## 检查与预览

按改动选择检查，不必每次跑全套：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

单测使用 Node 和隔离 D1，页面测试使用 Chromium / API mock，不请求源站；本地服务与 D1 测试需要回环端口权限。修改 Wrangler bindings 后运行 `pnpm cf-typegen`。

验证 PWA / 离线时，先运行 `pnpm preview`，在另一个终端执行：

```bash
PLAYWRIGHT_BASE_URL=http://localhost:8788 pnpm exec playwright test
```

该命令覆盖页面和真实 SW 接管 / 离线重载；普通开发测试跳过 SW 用例。手动检查可先在线加载、等待接管、在线重载，再断网重载。已有构建用 `pnpm start` 预览，不要在测试期间重建产物。

## 部署

正式入口 https://icbc-rate.tigerbook.top 。网站 `icbc-rate`、采集 `icbc-rate-collector`、D1 `icbc-rate`；目标 ID 以两个 Wrangler 配置为准。

```bash
pnpm run deploy
# 仅发布采集 Worker
pnpm run deploy:collector
```

脚本先迁移远程 D1、检查兼容性并初始化 / 校准数据，再发布 collector 和网站；失败即停止。build / preview 不连接生产，`pnpm upload` 会上传网站版本且绕过部署前数据检查，不作为日常发布入口。

生产数据库结构升级或破坏性操作前导出备份，不要求每次普通发布做恢复演练：

```bash
pnpm exec wrangler d1 export DB --remote --output .wrangler/backups/before-deploy.sql
```

如使用 Cloudflare Builds，只为网站配置一条流水线：Build command 留空，Deploy command 为 `pnpm run deploy`，变量 `PNPM_VERSION=11`；令牌需 D1 写权限和两个 Worker 发布权限。预览分支不要执行生产部署命令。Git 推送与实际部署成功分别确认。

## 价格提醒

页面底部“价格提醒”按设备设置一次性低价 / 高价通知。首次开启需要共享邀请码和系统通知权限；iPhone / iPad 先添加到主屏幕再打开。各设备单独设置，触发后手动重新开启，无需账号。测试通知由下一轮 Cron 发送。

首次配置（正式环境已有订阅时不要重新生成 VAPID 密钥）：

```bash
pnpm push:setup
```

密钥和随机邀请码保存在 Git 忽略的 `.wrangler/push-website-secrets.json`（权限 600），其中 `PUSH_INVITE_CODE` 即分享给使用者的口令。该文件需自行妥善保管。脚本同时生成 collector 的 Secret 文件，并补充本地 `.dev.vars` 中尚未设置的项，保留已有值。

首次正式配置时，先备份 D1、迁移并检查数据，再上传 Secret 和按既有入口发布。`secret bulk` 会部署当前线上代码版本，不会发布本地改动：

```bash
pnpm exec wrangler secret bulk .wrangler/push-website-secrets.json
pnpm exec wrangler secret bulk .wrangler/push-collector-secrets.json --config collector/wrangler.jsonc
pnpm run deploy
```

两个 Worker 的 `PUSH_VAPID_KEYS` 必须一致；网站额外需要 `PUSH_INVITE_CODE`。Secret 配置成功不代表新功能已经部署。后续部署无需重复生成或上传；仅修改邀请码不会撤销已加入设备。

清理浏览器数据后无法找回原设备凭证，可按 ID 撤销遗留订阅（同时删除该设备发送记录，不影响汇率历史）：

```bash
pnpm push:devices list                 # 默认本地 D1
pnpm push:devices remove <设备UUID>
pnpm push:devices list --remote        # 明确指定生产
pnpm push:devices remove <设备UUID> --remote
```

## 偶尔使用的命令

| 用途                                            | 命令                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| 本地采一次现价                                  | `pnpm db:collect`                                                                |
| 检查数据结构 / 生产就绪状态                     | `pnpm db:check` / `pnpm db:check:remote`                                         |
| 用已有数据修复缺日，不请求源站                  | `pnpm db:repair-gaps` / `pnpm db:repair-gaps:remote`                             |
| 调试 Cron（端口 8787，显式请求 `/__scheduled`） | `pnpm collector:dev`                                                             |
| 网站打包检查                                    | `pnpm exec wrangler deploy --dry-run --outdir .wrangler/website-check`           |
| 采集打包检查                                    | `node scripts/deploy-collector.mjs --dry-run --outdir .wrangler/collector-check` |

带 `:remote` 的命令访问生产；`collector:dev` 不会自行每分钟触发。构建产物在 `dist/client`、`dist/icbc_rate`，collector 独立打包。
