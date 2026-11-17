# 工商银行澳币汇率 PWA — 技术方案

本文记录当前实现与需长期保留的规则。开发约束见 [AGENTS.md](../AGENTS.md)，命令入口见 [README](../README.md)。

## 1. 项目目标与架构边界

- 展示工商银行澳大利亚元的现汇卖出价（个人购汇价）及每日历史趋势；内部字段统一为 `huiSell`。
- 移动端优先的 PWA，历史数据只存用户设备 IndexedDB；不同站点域名的本地数据相互独立，不自动迁移或共享。
- 同一份 Next.js 源码支持 Vercel 和 Cloudflare Workers，服务端负责抓取、解析与转发。
- 不引入业务数据库、服务端历史归档、Cron、后台定时采集或应用层服务端限流。Cloudflare 的 R2 只用于 OpenNext 增量缓存，不存用户历史。
- 不抓取买入价、现钞价等其他价位；如要扩展范围或全天自动采集，需另行确认架构变更。

## 2. 术语

银行“现汇卖出价”表示银行向个人卖出外汇，对应个人“购汇”。本项目只使用这一价位，不混用现汇买入、现钞买入或现钞卖出价格。

## 3. 数据源与日期

### 3.1 当日报价

- 源地址：`https://www.kylc.com/bank/rmbfx/b-icbc.html`。
- 服务端 HTML 表格，无浏览器 CORS 支持，通过同源 API 代理读取。
- `table#bank_rate_table` 中第一列 trim 后为“澳大利亚元”的行：第 4 列（下标 3）为 `huiSell`，第 6 列（下标 5）为发布时间。
- 发布时间 `MM-DD HH:mm` 一律按北京时间解释。当前北京时间月份为 1、源月份为 12 时取上一年；当前为 12、源月份为 1 时取下一年；其余取当前年。
- 解析与日期逻辑见 `src/lib/parse-today.ts`、`src/lib/date.ts`，源页面样本保存在 `src/lib/__fixtures__/`。

### 3.2 历史报价

- 源地址：`https://www.kylc.com/huilv/d-icbc-aud.html`，默认页面就是现汇卖出价历史。
- `datefrom=YYYY-MM-DD` 可指定起点，省略 `dateto` 获取至最新日期。项目默认请求往前 365 天；不带参数的源页面约有 28 天数据，不能据此认定源站仅支持 28 天。
- 第二个 `table.bank_huilv_table` 为逐日数据：第 1 列完整 ISO 日期，第 2 列 `span.td_rate` 为 `huiSell`。解析见 `src/lib/parse-history.ts`。
- 2026-06-23 至 2026-07-24 的调研样本中周六也有报价。此样本不作为固定休市日历，始终以实际返回日期集合判断空档。

## 4. 数据流

```text
浏览器 / PWA
  ├─ 卡片、趋势图、安装入口
  ├─ IndexedDB：fx-cache / rates（业务历史的唯一存储）
  └─ 同源 API：Vercel Route Handler / Cloudflare Worker
       ├─ /api/today   → 抓取当日页面 → 解析 → JSON
       └─ /api/history → 抓取历史页面 → 解析 → JSON
```

服务端响应可被平台缓存；业务合并、补缺与趋势计算在客户端完成。缓存不替代 IndexedDB，也不保证 App 关闭期间的数据采集。

## 5. 技术栈

| 用途         | 当前选型                                          |
| ------------ | ------------------------------------------------- |
| 框架与包管理 | Next.js 16 App Router、TypeScript、pnpm           |
| UI 与主题    | Tailwind CSS、shadcn/ui（Base UI）、next-themes   |
| HTML 解析    | cheerio，仅服务端                                 |
| 图表         | Chart.js + react-chartjs-2                        |
| 本地存储     | IndexedDB，通过 idb                               |
| PWA          | @serwist/next、serwist                            |
| 测试         | Vitest；Playwright（Chromium）                    |
| 部署         | Vercel；Cloudflare Workers（OpenNext + Wrangler） |

## 6. API 与缓存

### `GET /api/today`

返回示例：

```json
{
  "bank": "icbc",
  "currency": "aud",
  "date": "2026-07-24",
  "publishedAt": "2026-07-24T09:11:00+08:00",
  "huiSell": 4.7466
}
```

### `GET /api/history?datefrom=YYYY-MM-DD`

可选 `datefrom` 透传到源站。缺失或不匹配 `YYYY-MM-DD` 格式时，从当前北京时间日期向前 365 天开始请求。

```json
{
  "currency": "aud",
  "bank": "icbc",
  "field": "huiSell",
  "series": [
    { "date": "2026-07-24", "huiSell": 4.7466 },
    { "date": "2026-07-23", "huiSell": 4.7459 }
  ]
}
```

### 抓取与缓存约定

- `src/lib/sources.ts` 统一源地址、User-Agent、8 秒抓取超时与非成功响应处理；API 失败返回 502。
- `src/lib/api-cache.ts` 定义 today 300 秒、history 3600 秒的目标缓存窗口及 365 天默认回溯深度。
- Route Handler 的 `revalidate` 必须是可静态分析的数字字面量，与响应 `Cache-Control: s-maxage=..., stale-while-revalidate` 的窗口手动保持一致。
- **缓存配置不等于线上缓存已生效**：当前构建中 today 为静态 ISR 路由（5 分钟），history 因读取 `nextUrl.searchParams` 仍为动态路由。不能声称 history 仅凭 `revalidate = 3600` 就获得了 Vercel ISR 缓存；变更后应分别验证平台缓存响应头和实际行为。
- Cloudflare 的 OpenNext 使用 R2 增量缓存；Vercel 使用其平台缓存，不需要 Cloudflare 绑定或凭据。
- Serwist 的浏览器 API 缓存策略见第 10 节，与服务端响应缓存分开理解。

## 7. 客户端同步与空档

同步由 `src/lib/use-rate-data.ts` 驱动，合并与填补见 `src/lib/rates-sync.ts`：

1. 打开 App 时先读取本地数据显示，再后台同步；卡片刷新按钮、浏览器原生下拉刷新/整页重载也触发同步。每次返回前台都尝试同步：监听页面变为可见、窗口重新获得焦点，以及从往返缓存（bfcache）恢复；同一时间只运行一次同步，不设后台轮询。触发请求不代表绕过服务端 300 秒报价缓存。
2. 在本次同步写入 today 前检查本地最早、最新日期，**历史深度检查优先**：
   - 本地为空，或最早日期晚于“北京时间今天 − 365 天”：不传 `datefrom`，完整重新回溯；即使最新日期是今天也不跳过。
   - 深度足够，且最新日期是今天：跳过 history。
   - 其他情况：`datefrom=<本地最新日期>`，不能加一天。最新记录可能只是前一天的中途快照，需用历史数据再次确认并覆盖。
3. 两个 API 的真实记录按 `date` upsert。history 中当天的记录不参与合并，只信 today；today 失败时保留已有本地报价，不退回使用 history 的当天长缓存值。
4. 在本次 history **实际返回的最早至最晚日期**范围内枚举日期，缺失日期沿用最近的前一个真实记录，标为 `carried-forward`，`carriedFromDate` 指向真实日期。不得用填补记录继续填补，也不得补区间外的日期。
5. 后续真实报价 upsert 自动覆盖填补记录及标记，无需单独清理。
6. 本地无记录且无法按上述规则填补的日期保留缺失，以图表 `null` 断线呈现，不插值。默认回溯 365 天是本项目策略，不据此断言源站无法查询更早数据。
7. 离线或同步失败时保留本地数据；当前页面对同步异常显示“同步失败…展示的是本地已缓存数据”。

## 8. IndexedDB

数据库 `fx-cache`（版本 1），对象仓库 `rates`，主键 `date`。类型定义在 `src/lib/rates-db.ts`：

```ts
interface RateRecord {
  date: string; // YYYY-MM-DD
  huiSell: number;
  publishedAt: string | null; // today 来源才有发布时间
  source: "today" | "history" | "carried-forward";
  carriedFromDate: string | null; // 填补来源的真实日期
}
```

同一日期 upsert 覆盖旧记录；不存日内每次报价快照。

## 9. 页面与交互

- 首页默认 30 天，支持 7 天、30 天、90 天、半年、一年；卡片显示本地最新报价及其日期/发布时间。
- 同步时保留卡片两行结构与已有价格，只在时间旁加“（加载中…）”。
- 填补点在短区间用空心圆、tooltip 提示；超过 30 天只画线。不可恢复空档以断线显示。
- Chart.js 的辅助说明放 tooltip 或容器内叠加层，不能条件增加占 flex 空间的兄弟节点；返回前台主动 `resize()`。
- flex 容器同时作为 flex 子元素时加 `min-h-0`，避免撑出页面滚动。
- 主题只跟随系统，无手动切换入口；图表线条、网格、文字随主题变化。
- 刷新使用卡片按钮或浏览器原生下拉刷新，不自行实现手势。

## 10. PWA

- `src/app/manifest.ts` 生成 `/manifest.webmanifest`，图标在 `public/icons/`；manifest 使用静态品牌蓝，亮/暗浏览器主题色由 `layout.tsx` 的 `viewport.themeColor` 设置。
- `src/app/sw/sw.ts` 使用 Serwist，`runtimeCaching` 直接复用 `defaultCache`。同源 `/api/*` 用 **NetworkFirst（10 秒超时）**，不是 stale-while-revalidate。
- `next.config.ts` 用 `@serwist/next`；`dev`、`build` 都显式 `--webpack`。仅禁用 SW 编译不能消除插件与 Turbopack 的冲突。
- SW 类型环境由 `src/app/sw/tsconfig.json` 单独管理，根配置排除该目录；`pnpm typecheck` 检查主程序与 SW。
- 离线重载验证应先在线访问、确认 SW 激活并控制页面，再在线重载缓存导航，最后断网重载；不能用首次加载尚未受控的状态判断离线功能。
- 安装按钮依赖 Chromium/Android 的 `beforeinstallprompt`。iOS Safari 通过“分享 → 添加到主屏幕”安装，无对应脚本弹窗。

## 11. 部署与验证

操作命令和 Git 自动部署边界见 [README 的部署说明](../README.md#部署)。

- Vercel 运行 `pnpm build`；Cloudflare 通过 OpenNext 构建后由 Wrangler 发布。两套构建入口独立。
- `next.config.ts` 仅在开发阶段初始化 Cloudflare 本地绑定，生产构建不启动 Wrangler 本地运行时。
- Cloudflare Worker 名称与绑定以 `wrangler.jsonc` 为准，OpenNext 缓存适配器以 `open-next.config.ts` 为准。
- 已确认的 Cloudflare 发布地址：<https://icbc-rate.liaoshengtian.workers.dev>。Vercel 有历史部署记录，当前线上地址与 Git 集成状态未核实。
- 配置变更验证标准 Next.js 构建、完整 OpenNext 构建及 Wrangler 发布预检；标准 Next.js 产物不一定包含 OpenNext 要求的 standalone 输出，不能直接用跳过构建代替完整适配器验证。
- 发布后检查首页、两个 API、PWA 安装、离线重载，以及各平台缓存行为。仅 HTTP 200 不代表业务报价或缓存新鲜度正确。

## 12. 当前限制

- 报价按日期覆盖保存；没有日内完整变动记录、后台采集或推送提醒。
- App 未打开时不累积设备历史，下一次访问按源站实际返回数据补齐；清除站点存储会丢失本机历史。
- 源站 HTML 变化需同步更新解析函数、fixture 与相关测试，不能依赖调研时的结构永久不变。
- 测试规范见 AGENTS；现有 E2E 覆盖不等于所有验收路径均已有自动化用例。
