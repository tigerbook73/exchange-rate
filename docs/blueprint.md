# 工商银行澳币汇率 PWA — 技术方案与实施计划

## 1. 项目目标

- 只展示中国工商银行「澳大利亚元」的**购汇价**（即银行"现汇卖出价"——用人民币购买外汇，以外汇账户/电汇形式获得，非现钞）。
- 展示当日购汇价 + 历史趋势图，不需要买入价、现钞价等其他价位。
- 历史数据缓存在用户手机本地。
- 数据源：`kylc.com`（快易理财网），无官方 API，需抓取解析 HTML。
- 手机优先（Mobile First）的 PWA，可安装、可离线查看已缓存数据。
- 部署在 Vercel（Hobby 免费版），**不使用 Cron**，Vercel 仅作为跨域抓取代理，不做任何服务端持久化存储。
- 历史缺口由客户端在每次打开 App 时自动补齐（依赖数据源自带的近 28 天滚动窗口）。

## 2. 术语对应关系（重要）

银行报价的"买入/卖出"是站在银行角度：

| 银行术语       | 含义                   | 对应个人操作                       |
| -------------- | ---------------------- | ---------------------------------- |
| 现汇买入价     | 银行向客户买入现汇     | 结汇（把手里的外汇换成人民币）     |
| 现钞买入价     | 银行向客户买入现钞     | 结钞                               |
| **现汇卖出价** | **银行向客户卖出现汇** | **购汇（用人民币买外汇，非现钞）** |
| 现钞卖出价     | 银行向客户卖出现钞     | 购钞                               |

本项目只需要「现汇卖出价」这一列，字段内部命名为 `huiSell`。

## 3. 数据源调研结论（已验证）

### 3.1 当日购汇价

- URL: `https://www.kylc.com/bank/rmbfx/b-icbc.html`
- 服务端渲染的静态表格，`robots.txt` 允许抓取（`Allow: /`）。
- 定位「澳大利亚元」所在行，只取「现汇卖出」列（对应表头 `hui_sell`）和「发布时间」列（格式如 `07-24 09:11`，无年份、无时区）。
- 无 CORS 响应头，浏览器端**无法**直接 fetch，必须经服务端代理。
- **时区与年份拼接假设（需在 `/api/today` 实现中显式处理）**：
  - 发布时间字符串按**北京时间（Asia/Shanghai, UTC+8）**解释，不依赖服务器本地时区。
  - 年份不能直接套用"当前年份"，需处理跨年边界：若解析出的月份为 12 且当前月份为 1，年份取"当前年份 - 1"；若解析出的月份为 1 且当前月份为 12，年份取"当前年份 + 1"；其余情况直接用当前年份。

### 3.2 购汇价历史趋势

- URL：`https://www.kylc.com/huilv/d-icbc-aud.html`（不带任何后缀的默认页面，已验证标题即为「现汇卖出价历史与走势图」，正好是购汇价，不需要访问 `hui_buy.html` / `chao_buy.html` / `chao_sell.html` 这三个子页面）。
- 默认（不带参数）返回**最近约 28 天**的逐日数据表格（日期 + 现汇卖出价 + 涨跌%）。
- 已实测：URL 上附加 `startdate`/`enddate` 等猜测参数**不会**改变返回内容——自定义日期范围查询是前端 JS/AJAX 驱动的，未能在静态请求层面复现，因此**不做**任意区间查询，只依赖默认的 28 天滚动窗口。
- 结论：只要用户平均每月至少打开一次 App，历史就能通过这个滚动窗口自动补全；超过一个月未打开会产生不可恢复的空档，需要在 UI 上提示，属于可接受的已知限制。
- **已用真实数据核实发布节奏**：抽查 2026-06-23 ~ 2026-07-24 共 28 条记录，每个周六都有报价，只有周日缺失——不是常见假设里的"仅工作日发布"。客户端的空档判断不应硬编码"周末不发布"，而要以 `/api/history` 实际返回的日期集合为准（详见第 7 节）。

## 4. 总体架构

```
[手机浏览器 / PWA]
   ├─ UI：今日购汇价卡片 + 趋势折线图
   ├─ 本地存储：IndexedDB（购汇价历史序列）
   └─ fetch → Vercel Serverless Function（纯代理，无状态）
                 ├─ /api/today   → 抓取 b-icbc.html，解析澳元行的现汇卖出价，返回 JSON
                 └─ /api/history → 抓取 d-icbc-aud.html，解析近28天现汇卖出价表格，返回 JSON
                       （Vercel 端不存储，每次请求都是实时抓取转发）
```

- Vercel 端**只做**：请求转发 + HTML 解析 + JSON 输出。没有数据库、没有 Cron、没有持久化。
- 只需要 2 个源页面（而不是原方案的 5 个），抓取和解析逻辑更简单。
- 所有历史数据的"保存"发生在手机本地（IndexedDB）。

## 5. 技术栈

| 层        | 选型                             | 理由                                                                                             |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| 框架      | Next.js（App Router）            | API Route 天然是 Vercel Serverless Function，前后端一个项目，零额外配置                          |
| HTML 解析 | cheerio                          | 轻量、服务端可用，语法类似 jQuery，适合抓表格                                                    |
| 前端 UI   | React + Tailwind CSS + shadcn/ui | 移动端样式效率高；shadcn/ui 按需引入组件，自带主题（CSS 变量）机制                               |
| 图表      | Chart.js + react-chartjs-2       | Chart.js 为核心渲染库，react-chartjs-2 是其 React 组件封装，两者配合使用；轻量、移动端触屏体验好 |
| 本地存储  | IndexedDB（通过 idb 库封装）     | 容量远大于 localStorage，适合存时间序列                                                          |
| PWA       | @serwist/next（基于 Workbox）    | 自动生成 service worker + manifest，对 App Router 兼容性更好                                     |
| 部署      | Vercel Hobby（免费版）           | 与 Next.js 无缝集成，无需 Cron                                                                   |

## 6. 后端 API 设计（纯代理，无存储）

### `GET /api/today`

抓取 `b-icbc.html`，用 cheerio 定位「澳大利亚元」所在的 `<tr>`，只提取现汇卖出价和发布时间。

**已用真实响应核实的选择器**（源站结构变化时更新这里）：

- 表格：`table#bank_rate_table`（`data-role="table1"`），`tbody > tr`，找 `td:nth-child(1)` 文本 trim 后等于「澳大利亚元」的那一行（原始文本前面有 `&nbsp;`，需要 trim）。
- 列顺序（0-indexed）：`td[0]`=币种、`td[1]`=现汇买入、`td[2]`=现钞买入、`td[3]`=**现汇卖出（huiSell）**、`td[4]`=现钞卖出、`td[5]`=发布时间（格式 `MM-DD HH:mm`，如 `07-24 10:30`，无年份无时区，按第 3.1 节的规则处理）。

响应示例：

```json
{
  "bank": "icbc",
  "currency": "aud",
  "date": "2026-07-24",
  "publishedAt": "2026-07-24T09:11:00+08:00",
  "huiSell": 4.7466
}
```

### `GET /api/history`

抓取 `d-icbc-aud.html`，解析表格为逐日序列。

**已用真实响应核实的选择器**：页面里有两个 `table.bank_huilv_table`，第一个是"涨跌/最高/最低/平均"汇总表（不需要），真正的逐日数据表是**第二个**（`class` 里多一个 `text-nowrap`），结构：`thead > tr > th` 依次是「日期」「现汇卖出价」「涨跌%(与前日比)」「涨跌%(与首日比)」；数据行 `td:nth-child(1)` 是**完整 ISO 日期**（`YYYY-MM-DD`，自带年份，不需要像 `/api/today` 那样处理年份/时区），`td:nth-child(2)` 里的 `span.td_rate` 是现汇卖出价数值。

响应示例：

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

实现要点：

- 设置合理的 `User-Agent`，避免被识别为异常爬虫。
- 加超时和异常处理。
- 响应头加 `Cache-Control: s-maxage=300, stale-while-revalidate`，利用 Vercel 边缘缓存减少对源站的重复请求（**不做**应用层的内存级请求频率限制——Serverless Function 实例无状态、水平扩展，内存计数器无法跨实例共享，起不到可靠限流效果；对源站的保护完全依赖边缘缓存自然摊薄重复请求）。

## 7. 前端本地缓存与"自动补缺"逻辑

1. App 启动（或用户下拉刷新）时：
   - 调用 `/api/today`，得到当天最新购汇价。
   - 调用 `/api/history`，得到最近 28 天购汇价序列。
2. 与 IndexedDB 中已有的 `rates` 表按 `date` 做 upsert（新数据覆盖旧数据，因为源站数据可能会有微调）。
3. 界面上默认展示"今日购汇价"用 `/api/today` 的结果（最新，含具体发布时间）；趋势图数据来自本地 IndexedDB 里的全部历史记录（不止 28 天，是设备上累计的所有天数）。
4. 检测本地历史是否有日期空档，分两种情况区别处理：
   - **不假设固定的休市规律，以源站实际返回的日期集合为准**：已用真实数据核对，工行发布节奏是"周六有报价、只有周日没有"，并非"仅工作日"这种直觉假设。判空档时对比「本地 IndexedDB 已有日期」与「`/api/history` 这次实际返回的 28 天日期集合」。
   - **28 天源站窗口内的空档（比如周日）→ 用最近一天的真实数据填补，并在展示时标注**：取本地已有的、日期上最近的前一个真实数据（沿用其 `huiSell`），写回 IndexedDB 时标记为填补记录（`source: "carried-forward"`，并记录 `carriedFromDate` 指向真实数据的日期），趋势图上这类点用醒目的说明呈现（例如"该日期未更新，数据来自 07-18"），不能让用户误以为是当天的真实报价。**回溯范围限制在 28 天源站窗口内**，不无限回溯。
   - **超过 28 天源站窗口、彻底追不到真实数据的空档**（用户超过一个月没打开 App）→ 维持原方案的"数据缺失"处理：标记为"数据缺失（源站未提供更早查询）"，图表上以断线或灰色提示呈现，不做插值伪造数据，也不做填补。
   - **标记清除**：只要之后某次 `/api/history` 或 `/api/today` 同步真的带回了该日期的数据，upsert 时用真实记录（`source: "today" | "history"`）覆盖掉之前的填补记录，标记自动消失，无需额外清理逻辑。
5. 离线状态：service worker 缓存最近一次成功的 API 响应（stale-while-revalidate），无网络时直接读 IndexedDB 展示已缓存内容，并给出"离线，数据为 XX 时刻缓存"提示。

## 8. IndexedDB 数据结构

```
数据库：fx-cache
对象仓库：rates (keyPath: date)
字段：
  date: string             // "2026-07-24"
  huiSell: number           // 购汇价；若 source 为 carried-forward，值等于 carriedFromDate 当天的 huiSell
  publishedAt: string       // 仅当日（source==="today"）记录有，其余可为空
  source: "today" | "history" | "carried-forward"
  carriedFromDate: string | null  // 仅 source==="carried-forward" 时有值：真实数据来自哪一天，用于 UI 文案"数据来自 MM-DD"
```

## 9. 前端页面设计（移动优先，单一价位、无需切换）

- **首页（单页）**
  - 顶部：购汇价卡片，大字号显示当前价格，下方小字展示更新时间。
  - 中部：时间范围切换（7天 / 30天 / 全部本地历史），折线图展示购汇价走势。
  - 无需价位类型切换（不再有买入/现钞的 Tab）。
  - 底部：数据来源与免责声明文字（"数据来自快易理财网，仅供参考，以银行官网实际成交汇率为准"）。
- 响应式断点以手机为主（375–430px 设计基准），大屏做居中卡片布局即可，不必单独做桌面版。
- 下拉刷新（pull-to-refresh）触发重新拉取 `/api/today` + `/api/history`。
- **主题支持**：默认跟随系统 `prefers-color-scheme`，并在页面上提供手动切换入口（亮色 / 暗色 / 跟随系统），基于 shadcn/ui 的 CSS 变量主题机制实现；图表配色（折线、网格线、坐标轴文字）需随主题联动，不能硬编码亮色假设。

## 10. PWA 配置要点（已实现，记录实际方案）

- `manifest`：用 Next.js App Router 的 `src/app/manifest.ts` 文件约定生成（自动产出 `/manifest.webmanifest` 并在 `<head>` 里自动加 `<link rel="manifest">`，不需要手写静态 `manifest.json` 或手动加 link 标签）。图标用 Playwright 截图一个简单的 HTML（蓝底白字"汇"）生成 192×192 / 512×512 / 180×180（iOS `apple-touch-icon`）三个 PNG，放在 `public/icons/`。
- 主题色：`manifest.ts` 里的 `theme_color` 只能给一个静态值（品牌蓝 `#2563eb`）；亮/暗两套 `theme-color` 通过 `src/app/layout.tsx` 的 `viewport.themeColor` 数组（`[{media, color}, ...]`）实现，对应实际的亮/暗背景色。
- Service Worker：`src/app/sw.ts` 用 `serwist` 包的 `Serwist` 类手写，`runtimeCaching` 直接复用 `@serwist/next/worker` 导出的 `defaultCache`——它已经内置了"静态资源 cache-first / stale-while-revalidate"+"同源 `/api/*` 用 `NetworkFirst`（10 秒超时）"这套策略，和本节最初的设计要求刚好一致，**不需要自己写自定义 runtimeCaching 规则**。
- **重要坑（已解决）**：`@serwist/next` 底层是 webpack 插件，而 Next 16 的 `next dev`/`next build` 默认用 Turbopack，两者冲突（直接报错拒绝启动/构建）。解决方式：
  - `next.config.ts` 里 `withSerwistInit({ ..., disable: process.env.NODE_ENV !== "production" })`：这一步**只是**让开发环境跳过 SW 的实际编译逻辑（`defaultCache` 在非生产环境本来就会退化成纯 `NetworkOnly`，跳过没有任何实际损失），**不能单独解决 Turbopack 冲突**——`withSerwistInit` 不管 `disable` 是什么都会往返回的 config 上挂一个 `webpack(...)` 函数，Next 是看这个函数存不存在来判断"是不是有自定义 webpack 配置"，不是看它会不会真的执行到。
  - 真正解决冲突要靠：`package.json` 的 `dev` 和 `build` 两个脚本都显式加 `--webpack`（`next dev --webpack` / `next build --webpack`），完全不让 Turbopack 参与，两者缺一不可（只加 build 不加 dev，dev 环境下改几次文件触发重新编译后一样会报错）。
  - 评估过官方新出的 `@serwist/turbopack`（用 esbuild 代替 webpack、把 SW 改成 Route Handler 动态提供，原生兼容 Turbopack）作为替代方案，但它的集成方式和现在的 `@serwist/next` 完全不同（要重写 `next.config.ts`、新增一个 route 文件），而且官方文档里自己标注为"实验性支持"；权衡稳定性后维持 `--webpack` 方案，没有切换。
  - `src/app/sw/sw.ts` 需要 `webworker` 类型环境（`self`、`ServiceWorkerGlobalScope` 等），和主程序 tsconfig 的 `dom` 环境冲突，不能共用一个 tsconfig。**注意**：一开始在项目根目录另建一个同级的 `tsconfig.worker.json`（文件名不同、目录相同）不够——VS Code 给某个文件配对 tsconfig 是按"从该文件所在目录往上找最近的、名字就叫 `tsconfig.json` 的文件"来定的，同目录下改名的兄弟文件它不会主动发现，编辑器还是会用根 `tsconfig.json`（`dom` 环境）检查这个文件，照样报 `Cannot find name 'ServiceWorkerGlobalScope'`。正确做法是**把 sw 相关文件单独放一个子目录、且子目录里的 tsconfig 文件名必须叫 `tsconfig.json`**：`src/app/sw/{sw.ts, tsconfig.json}`（子目录里的 `tsconfig.json` 设 `lib: ["ES2020", "WebWorker"]`，只 `include: ["sw.ts"]`），这样 VS Code 打开 `src/app/sw/sw.ts` 时会先找到这个更近的 `tsconfig.json`。根 `tsconfig.json` 的 `exclude` 加 `src/app/sw`，`pnpm typecheck` 依次跑 `tsc --noEmit && tsc --noEmit -p src/app/sw/tsconfig.json`，两边都有类型检查覆盖。
- **已验证的行为（非 bug，PWA 通用特性）**：Service Worker 首次安装时不会控制"触发安装的那次页面加载"，要等下一次导航才会真正接管请求。所以"离线也能重新打开 App"这个场景，测试/验证时要先完整访问 → 再刷新一次（在线状态下，让 SW 接管这次导航并把页面缓存进去）→ 才能断网重载验证，否则会看到离线直接加载失败（这不是这个项目的缺陷，是所有基于 Service Worker 的 PWA 的通用行为）。
- 添加到主屏幕的引导提示：未实现（按原计划为可选项）。

## 11. 部署步骤（Vercel Hobby，无 Cron）

1. 本地用 `create-next-app` 初始化项目，接入 Tailwind、@serwist/next、cheerio、idb、chart.js。
2. 实现 `/api/today`、`/api/history` 两个 Route Handler（各自只抓一个源页面）。
3. 实现前端页面、IndexedDB 读写逻辑、图表组件。
4. 本地 `next build && next start` 验证，确认 PWA 可安装、离线可用。
5. 推送到 GitHub，Vercel Import Project，框架自动识别为 Next.js，无需额外环境变量（本方案不依赖数据库/密钥）。
6. 部署后用手机浏览器打开，测试"添加到主屏幕"、断网后重新打开、多日后重新打开时历史补齐的场景；同时检查 `/api/today`、`/api/history` 响应头中的 `x-vercel-cache`（HIT/MISS），确认边缘缓存按预期生效。

## 12. 已知限制 / 后续可选优化

- 超过 28 天未打开 App 会产生无法恢复的历史空档（源站限制，非本方案缺陷）。
- 若未来想要"无论用户是否打开 App 都完整存档每日数据"，需要引入服务端持久化 + 定时任务（如 Vercel Cron + Vercel KV，或迁移到有免费 Cron 额度的平台），当前方案按用户要求不包含此部分。
- 若源站结构调整，`/api/today`、`/api/history` 的 cheerio 选择器需要同步更新，建议解析逻辑单独封装，便于维护。
- 抓取频率建议克制（例如客户端合并请求、加缓存），避免给源站造成压力，也规避被封 IP 的风险。
- 若后续想加回买入价/现钞价，只需扩展 `/api/today` 和 `/api/history` 的解析字段，以及新增对应的历史子页面（`hui_buy.html` / `chao_buy.html` / `chao_sell.html`），架构上是平滑扩展。

## 13. 建议的实施顺序（供代码生成参考）

1. 初始化 Next.js 项目 + 基础依赖。
2. 实现 `/api/today` 并用真实请求验证解析正确性（只取现汇卖出价）。
3. 实现 `/api/history` 并验证解析正确性（`d-icbc-aud.html` 默认页面）。
4. 搭建 IndexedDB 封装模块（增删查、按日期 upsert、查询空档）。
5. 搭建首页 UI（购汇价卡片 + 图表 + 时间范围切换）。
6. 接入 @serwist/next，完成 manifest 与 service worker 配置。
7. 本地全流程测试（含模拟离线、模拟多日未打开）。
8. 部署 Vercel，真机验证。
