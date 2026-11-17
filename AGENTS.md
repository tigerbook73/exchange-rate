<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — 工商银行澳币汇率 PWA

展示工商银行澳大利亚元的**现汇卖出价（个人购汇价，字段 `huiSell`）**与历史趋势。

本文件保留实现约束；接口、同步规则、缓存与部署现状见 [技术方案](docs/blueprint.md)。两者冲突时先核对实现并同步文档，不沿用已过时的描述。

## 架构边界

- 用户历史数据只存设备 IndexedDB，不新增数据库、KV 或服务端历史归档。Cloudflare 已有 R2 仅作 OpenNext 增量缓存，不作为业务数据存储。
- 不加 Cron、后台定时采集或应用层服务端限流；源站保护依靠响应缓存。刷新由打开 App、手动刷新/整页重载或返回前台触发，每次返回前台都尝试刷新；同一时间只运行一次同步，不因五分钟缓存窗口跳过唤醒刷新。
- 只抓取 `huiSell`；Route Handler 只负责抓取、解析和转发，补缺、合并及趋势计算放客户端 `src/lib/`。
- 新功能涉及突破上述边界时先与用户确认。不要把部署适配器所需缓存扩展成历史数据持久化。

## 领域规则

- 时间按北京时间（`Asia/Shanghai`、UTC+8）解释，不依赖服务器或设备本地时区。
- 源站 `MM-DD HH:mm` 无年份：源月份为 12、当前为 1 时取上一年；源月份为 1、当前为 12 时取下一年；其余取当前北京时间年份。
- `datefrom` 有效；默认回溯 **365 天**，不是源站固定 28 天窗口。先检查本地历史深度，不足时完整回溯；深度足够且最新日期是今天才跳过 history；否则从**本地最新日期本身**增量请求，不能加一天。详见技术方案第 7 节。
- 当天真实报价只信 `/api/today`；过滤 history 中当天记录。today 失败时保留本地记录，不用 history 的长缓存值替代。
- 按 history **实际返回的最早至最晚日期**判断空档，不硬编码周末规律。调研样本中周六也有报价。
- 仅在该区间内沿用最近的前一个真实记录，保存 `source: "carried-forward"` 与指向真实日期的 `carriedFromDate`；不能连续沿用填补记录。后续真实数据 upsert 自动覆盖标记。
- 无法填补的日期保持缺失，图表断线，不插值。UI 必须区分真实报价和沿用值，并清楚标明来源日期（如“该日期未更新，数据来自 MM-DD”）。

## 技术选型与组织

- Next.js App Router、TypeScript、pnpm；写 Next.js 代码前读本地对应版本文档。
- shadcn/ui（**Base UI**）+ Tailwind；基础组件用 CLI 按需生成，生成组件放 `src/components/ui/`，业务组件放 `src/components/`。
- cheerio 仅服务端使用；IndexedDB 用 `idb`；图表用 Chart.js + react-chartjs-2。
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
- Cloudflare 本地运行时只在 `PHASE_DEVELOPMENT_SERVER` 初始化，生产构建不能无条件调用它。Vercel 用 `pnpm build`，Cloudflare 用 `pnpm deploy`，两边配置保持兼容。
- Route Handler 的 GET 默认不缓存。`revalidate` 用可静态分析的数字字面量，与 `src/lib/api-cache.ts` 的响应头窗口保持一致；不能仅凭配置就认定 CDN 已缓存。history 读取 query，当前构建仍为动态路由，须另查线上响应。详见技术方案第 6 节。
- 页面 `params`/`searchParams`、`cookies()`、`headers()` 等异步 API 要 `await`；`NextRequest.nextUrl.searchParams` 是同步 URL API，不混为一谈。
- SW 独立使用 `src/app/sw/tsconfig.json` 的 WebWorker 类型环境；根 tsconfig 排除该目录，`pnpm typecheck` 检查两套配置。
- 后续需要中间件时使用 Next.js 16 的 `proxy.ts` 约定。

## 测试与工作流

- Vitest 覆盖时区/跨年、解析、upsert、空档填补等领域逻辑；HTML 解析用本地 fixture，测试不请求 `kylc.com`。
- Playwright 用例放 `e2e/`，必须 `page.route()` mock 两个 API（包含 query 请求）。验证卡片、现有时间范围、系统主题变化、刷新、加载结构与缓存/离线路径；这些是覆盖要求，不表示现有用例已全部覆盖。
- 当前 Playwright 只跑 Chromium。若自动启动 dev server 卡住，先手动启动 `pnpm dev`，就绪后再跑 `pnpm test:e2e` 复用服务。
- 常用命令见 [README](README.md)。分阶段功能的计划与验收见 [阶段工作流](docs/phase-workflow.md)，日常小改无需建立阶段文档。
- 阶段内可自主创建 Conventional Commits；日常改动仅在用户要求时提交。阶段收尾文档整理单独提交，不混入其他阶段。
- `git push` 仍需用户明确授权；本地部署命令不会推送 GitHub。
