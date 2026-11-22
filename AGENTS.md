<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — 工商银行澳币汇率 PWA

展示工商银行澳大利亚元的**现汇卖出价（个人购汇价，字段 `huiSell`）**与历史趋势。

本文件保留实现约束；接口、同步规则、缓存与部署现状见 [技术方案](docs/blueprint.md)。两者冲突时先核对实现并同步文档，不沿用已过时的描述。

## 架构边界

- 用户已授权 Cloudflare 单平台、服务端定时采集和 D1 持久化；保留 Next.js + OpenNext，不迁移 vinext。R2 仅用于框架增量缓存，不作业务历史库。
- 采集链路不申请租约锁；一次状态读取和一次原子批量提交，按分钟幂等，条件 revision + 批次写入标记防止重复 / 旧响应污染新状态。允许偶发并发重复抓取或冲突跳过；不逐轮写 D1 诊断表，使用结构化日志。
- 独立采集 Worker 每分钟 POST 工商银行现价 JSON API；网页 API 只读 D1，任何客户端访问、刷新、冷缓存或空库都不得触发源站抓取。不提供公开强制采集入口。
- D1 是权威数据，IndexedDB 和 Service Worker 保留设备离线副本。前台每分钟查询增量，隐藏 / 离线停止，唤醒立即尝试，同一时间仅一次同步。
- 补缺、历史校准和保留清理放服务端；客户端负责原子应用版本、替换临时点、绘图和离线展示。业务逻辑放 `src/lib/`。
- 不自行引入 KV、Queues、Durable Objects 或其他业务服务；超出当前计划时先与用户确认。
- 用户已于 2026-11-22 授权正式 Cloudflare 部署及必要资源创建，本地提交亦已授权；`git push` 仍需明确授权。部署必须先迁移和初始化 D1，检查就绪后再发布网站。不要把本地通过描述为线上验证。
- 日常进度写入 [进度文件](docs/progress/cloudflare-server-rates.md)；范围和规则未变化时保持 [计划](docs/plans/phase-1-cloudflare-server-rates.md) 不变。
- API schema 不兼容时允许一次自动整页刷新；新版获取并校验兼容快照后才能原子清空并重建旧本地数据。普通错误或报价 revision 变化不得触发清空，不删除新版资源或服务端历史。
- D1 结构代次与必需字段只在显式检查 / 部署前 preflight 校验，不在 API / Cron 中单独查询或比较；实际读写错误按未就绪处理，不自动删库。统一部署先迁移再检查与初始化，失败停止发布；无法迁移的全量重建须备份并显式操作。

## 领域规则

- 时间按北京时间（`Asia/Shanghai`、UTC+8）解释，不依赖服务器或设备本地时区。
- 当前官方源使用完整 `publishDate` + 秒级 `publishTime`，按 UTC+8 解析；`foreignSell` 为人民币 / 100 澳元，需转换到每澳元。旧网页源仅显式比较使用，不自动回退。旧网页源 `MM-DD HH:mm` 无年份：源月份为 12、当前为 1 时取上一年；源月份为 1、当前为 12 时取下一年；其余取当前北京时间年份。
- 采集分钟按请求实际发起时间截断到分钟：10:05:05 算 10:05，跨分钟返回不改归属。Cron 计划时间只用于诊断，迟到任务不能倒填计划分钟。
- 固定保存整 5 分钟点，其间只覆盖一个临时点。固定点失败允许使用前 5 分钟内最近真实成功值，标来源；不能把回退值继续作为真实值沿用。固定点处理后清空旧临时点。
- 界面仅看当天分时；源站 `publishedAt` 仍是旧日期时，自动回退最近有效报价日，卡片和图表标明完整日期。采集成功不代表已发布今日报价，同日价格未变不等于无效，不猜测开盘时间。三日保存只作预备，不提供三日切换。
- 日内固定点保留北京时间今天及前两天；每日历史长期保留，默认初始回溯 **365 天**，不是源站固定 28 天窗口。历史游标独立于当天采样，从最后确认日期本身开始校准，不加一天。
- 当天只信真实采集的当日报价，过滤 history 当天记录。采集失败保留最近成功值，不用 history 当天值替代。
- 按 history **实际返回的最早至最晚日期**判断空档，不硬编码周末规律。调研样本中周六也有报价。
- 仅在该区间内沿用最近的前一个真实记录，保存 `source: "carried-forward"` 与指向真实日期的 `carriedFromDate`；不能连续沿用填补记录。后续真实数据 upsert 自动覆盖标记。
- 无法填补的日期保持缺失，图表断线，不插值。UI 必须区分真实报价和沿用值，并清楚标明来源日期（如“该日期未更新，数据来自 MM-DD”）。

## 技术选型与组织

- Next.js App Router、TypeScript、pnpm；写 Next.js 代码前读本地对应版本文档。
- shadcn/ui（**Base UI**）+ Tailwind；基础组件用 CLI 按需生成，生成组件放 `src/components/ui/`，业务组件放 `src/components/`。
- 现价使用工商银行 JSON API，旧网页 `htmlparser2` 解析保留但不启用；历史使用 `cheerio/slim`，仅在部署前本机 / CI 或显式回填中运行，不放入日常 Cron；IndexedDB 用 `idb`；图表用 Chart.js + react-chartjs-2。数据库和类型从 Wrangler 配置生成，不手写复制 Env。
- PWA 用 `@serwist/next`，`runtimeCaching` 复用 `defaultCache`，不要另造缓存规则或换成 `next-pwa`。
- 新增依赖优先最新稳定版，有兼容性原因保留旧版时注明理由；有适用脚手架时优先生成再调整。
- 业务逻辑放 `src/lib/`；单测与源文件同目录，不建顶层 `__tests__`。

## 主题与布局

- `next-themes` 使用 `defaultTheme="system"` + `enableSystem`，只跟随系统，不加手动主题按钮。新 UI 和图表配色须验证亮、暗两种模式。
- manifest 只有静态主题色；亮暗浏览器主题色通过 `layout.tsx` 的 `viewport.themeColor` 设置。
- 已有内容在同步中保持结构和值，仅叠加行内加载提示，参考 `RateCard`；不能整块换成骨架屏或加载文字。
- 同时作为 flex 子元素和 flex 容器的元素默认加 `min-h-0`，避免内容撑破页面。
- Chart.js 画布旁不要条件渲染占布局空间的 flex 兄弟说明；改用 tooltip 或容器内绝对定位，防止 ResizeObserver 引起布局抖动。
- PWA 返回前台时保留图表主动 `resize()`，避免手机后台恢复后的画布尺寸错误。

## 构建与部署易错点

- Serwist 注入 webpack 配置，`dev`、`build` 都必须保留 `--webpack`。仅 `disable: true` 不能消除 Turbopack 冲突。
- Cloudflare 本地运行时只在 `PHASE_DEVELOPMENT_SERVER` 初始化，生产构建不能无条件调用它。标准 Next 构建用于验证应用，完整 OpenNext 构建用于目标平台；不再要求 Vercel 部署兼容。
- Route Handler 的 GET 默认不缓存。目前查询为动态路由，响应配置 15 秒共享缓存与有界陈旧窗口；不能仅凭响应头认定线上 CDN 命中。同步完整游标参与缓存键，元数据版本必须对应实际内容。
- Serwist 预缓存排除 Cloudflare `/_headers` 和 `/_redirects`；它们不是可请求的静态文件，404 会导致 SW 安装失败。
- 页面 `params`/`searchParams`、`cookies()`、`headers()` 等异步 API 要 `await`；`NextRequest.nextUrl.searchParams` 是同步 URL API，不混为一谈。
- SW 使用 `src/app/sw/tsconfig.json`，独立采集 Worker 使用 `collector/tsconfig.json`；根 tsconfig 排除两目录，`pnpm typecheck` 检查三套环境。
- 后续需要中间件时使用 Next.js 16 的 `proxy.ts` 约定。

## 测试与工作流

- Vitest 覆盖时区/跨年、解析、upsert、空档填补等领域逻辑；HTML 解析用本地 fixture，测试不请求 `kylc.com`。
- Playwright 用例放 `e2e/`，mock 查询 API（含 `/api/sync` 游标请求及兼容接口）。验证卡片、时间范围、系统主题、增量、前台轮询、唤醒合并、加载结构与离线路径；生产 SW 需单独验证真实接管和断网重载，不能用 dev 禁用 SW 的状态判断。
- 当前 Playwright 只跑 Chromium。若自动启动 dev server 卡住，先手动启动 `pnpm dev`，就绪后再跑 `pnpm test:e2e` 复用服务。
- 常用命令见 [README](README.md)。分阶段功能的计划与验收见 [阶段工作流](docs/phase-workflow.md)，日常小改无需建立阶段文档。
- 阶段内可自主创建 Conventional Commits；日常改动仅在用户要求时提交。阶段收尾文档整理单独提交，不混入其他阶段。
- `git push` 仍需用户明确授权；本地部署命令不会推送 GitHub。
