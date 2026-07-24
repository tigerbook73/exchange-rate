<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — 工商银行澳币汇率 PWA

本文件是本项目的 Agent 指导文件，约束后续设计与实现。完整技术方案见 [`docs/blueprint.md`](./docs/blueprint.md)，本文件只提炼**容易出错、容易被遗忘**的约束，两者冲突时以 `docs/blueprint.md` 最新内容为准，发现冲突应先同步更新再继续。

## 项目一句话说明

只做一件事：展示工商银行「澳大利亚元」**现汇卖出价（购汇价，字段名 `huiSell`）**的当日报价与历史趋势，纯客户端存储，Vercel 仅作无状态抓取代理。

## 架构红线（不要引入）

- **不加服务端持久化**（数据库、KV、文件存储）。历史数据只存在用户设备的 IndexedDB。
- **不加 Cron / 定时任务**。数据刷新只在用户打开 App / 下拉刷新时发生。
- **不做应用层请求频率限制**（Serverless 实例无状态、水平扩展，内存计数器不可靠）。对源站的保护依赖 `Cache-Control: s-maxage` 边缘缓存，不要为了"限流"引入额外的存储依赖。
- **不抓取除现汇卖出价以外的价位**（买入价、现钞价等），除非用户明确要求扩展。
- API Route（`/api/today`、`/api/history`）只做「抓取 → 解析 → 转发 JSON」，不做业务逻辑，业务逻辑（补缺、趋势计算）放在客户端。

## 领域规则（容易踩坑，务必遵守）

- **术语**：银行「现汇卖出价」= 个人「购汇」。项目内部统一用字段名 `huiSell`，不要用 `sell` / `rate` 等模糊命名。
- **时区**：源站发布时间字符串（如 `07-24 09:11`）无年份、无时区，一律按**北京时间（Asia/Shanghai, UTC+8）**解释，不依赖服务器本地时区（`Intl` / 日期库需显式指定时区，不要用 `new Date()` 默认行为）。
- **年份拼接跨年处理**：解析出的月份为 12 且当前月份为 1 → 年份取"当前年份 − 1"；解析出的月份为 1 且当前月份为 12 → 年份取"当前年份 + 1"；否则用当前年份。不要简单地"拼接当前年份"。
- **空档判断以源站实际发布的日期集合为准，不要假设固定的休市规律**：已用真实数据核对 `d-icbc-aud.html`（2026-06-23 ~ 2026-07-24 期间），**每个周六都有报价，只有周日没有**——工行网站的发布节奏并非"仅工作日"，早期方案里"周六周日都不发布"的假设是错的，不要照搬。判空档时把「本地已有日期」与「`/api/history` 这次实际返回的日期集合」做差集。
- **28 天源站窗口内的空档：用最近一天真实数据填补，并标注来源，不留白/不断线**：取本地已有的、日期上最近的前一个真实数据的 `huiSell` 填补该日期，写回 IndexedDB 时标成 `source: "carried-forward"` 并记录 `carriedFromDate`（指向真实数据所在日期），UI 上要清楚标注"该日期未更新，数据来自 MM-DD"，不能让用户误以为是当天的真实报价。**回溯范围限制在 28 天源站窗口内，不无限回溯**——超出这个窗口、彻底追不到真实数据的空档，走下一条规则的"数据缺失"处理，不做填补。
- **标记的自动清除**：填补记录不需要额外的清理逻辑——只要后续某次同步真的带回了该日期的数据，upsert 用真实记录（`source: "today"` 或 `"history"`）覆盖掉之前的填补记录即可，标记随之消失。
- **28 天滚动窗口是硬限制**：`d-icbc-aud.html` 不支持自定义日期区间查询（已实测 `startdate`/`enddate` 无效），历史补齐只能依赖默认返回的近 28 天数据。超过 28 天源站窗口、本地也追不到真实数据的空档不可恢复，是已知限制：不做填补、不做插值，标记为"数据缺失（源站未提供更早查询）"，图表上以断线或灰色提示呈现。

## 技术栈约束

| 层        | 选型                                                                         | 备注                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架      | Next.js（App Router）                                                        |                                                                                                                                                                                                         |
| HTML 解析 | cheerio                                                                      | 仅服务端（Route Handler）使用                                                                                                                                                                           |
| UI 组件   | shadcn/ui（基于 Tailwind CSS，底层原语库为 **Base UI**，非早期版本的 Radix） | 组件用 `npx shadcn add` 按需引入，不要手写重复造轮子的基础组件（Button/Card/Dialog 等）；深度定制样式优先改 Tailwind 配置/CSS 变量，而不是绕开 shadcn 自己写                                            |
| 主题      | 支持亮色/暗色（浅色为默认，跟随系统 `prefers-color-scheme`，并提供手动切换） | 见下方「主题支持」                                                                                                                                                                                      |
| 图表      | Chart.js + react-chartjs-2                                                   | 两者配合使用（后者是前者的 React 封装），需适配主题色（暗色模式下网格线/文字颜色要跟着变）                                                                                                              |
| 本地存储  | IndexedDB（通过 `idb` 库封装）                                               |                                                                                                                                                                                                         |
| PWA       | `@serwist/next`                                                              | 不用 `next-pwa`（对 App Router 兼容性差、维护停滞）；`runtimeCaching` 直接用其 `defaultCache`（已内置 `/api/*` 走 NetworkFirst），不用自己写缓存规则；与 Turbopack 冲突，见下方「Next.js 版本注意事项」 |
| E2E 测试  | Playwright（`@playwright/test`）                                             | 见下方「测试规范」；配置在根目录 `playwright.config.ts`，用例放 `e2e/`                                                                                                                                  |
| 部署      | Vercel Hobby（免费版）                                                       | 无 Cron、无数据库                                                                                                                                                                                       |
| 包管理器  | pnpm                                                                         | 遵循用户全局 CLAUDE.md 约定                                                                                                                                                                             |

## 主题支持（新增要求）

- 使用 shadcn/ui 自带的主题机制（CSS 变量 + `next-themes` 或等价方案），默认跟随系统设置，同时提供手动切换入口（亮色 / 暗色 / 跟随系统）。
- `manifest.json` 的 `theme_color` / `background_color` 需要同时考虑亮色与暗色两套取值（PWA manifest 本身只支持单一静态值，若要区分需结合 `meta[name=theme-color][media=...]` 或在应用内动态设置）。
- 图表配色（折线、网格线、坐标轴文字）不能硬编码亮色假设，需要随主题切换联动，参考项目里 `dataviz` skill 的配色方法论保持视觉一致性。
- 新增 UI 组件时默认要在亮色和暗色下都验证过，不要只测一种主题就提交。

## Next.js 版本注意事项（当前锁定 16.x，非训练数据里熟悉的版本）

- 写代码前先读 `node_modules/next/dist/docs/` 里对应指南，不要凭训练数据里的旧 API 假设。
- Route Handler 的 `GET` **默认不缓存**（Next 15+ 起的行为）；本项目依赖的是手动设置 `Cache-Control: s-maxage=...` 响应头走 Vercel 边缘缓存，与 Next 内部的 fetch/route 缓存是两套机制，不要混淆、也不需要额外配置 `export const dynamic = 'force-static'`。
- `params`、`searchParams`、`cookies()`、`headers()` 等一律是异步的（返回 Promise），需要 `await`。
- `next dev` / `next build` 默认用 Turbopack（无需 `--turbopack` 参数），若未来引入自定义 Webpack 配置需注意兼容性。**已踩坑**：`@serwist/next` 底层是 webpack 插件，next.config 里只要挂了 `webpack(...)` 函数，Turbopack 就会报错拒绝启动——**光靠运行时 `disable: true` 不够**，因为 `withSerwistInit` 不管 `disable` 是什么都会往 config 上挂 `webpack` 键，Next 是看这个键是否存在来判断冲突，不是看它实际会不会执行。真正生效的解法是 `dev`、`build` 两个 script 都显式加 `--webpack`（`next dev --webpack` / `next build --webpack`），`disable: process.env.NODE_ENV !== "production"` 只用来跳过开发环境下没意义的 SW 编译，不能替代 `--webpack`。评估过官方的 `@serwist/turbopack`（esbuild + Route Handler 动态提供 SW，原生免 webpack）作为替代，但集成方式整个不一样（要重写 next.config + 新建 route），官方自己也标了"实验性支持"，权衡后维持 `--webpack` 方案。新增其他依赖 webpack 插件机制的工具时，先假设它和 Turbopack 不兼容，别默认它能直接工作。
- 中间件文件约定已从 `middleware.ts` 改名为 `proxy.ts`（本项目目前不需要中间件/proxy，若后续要加，用新约定名）。

## 依赖版本与脚手架

- **组件/依赖版本**：新增依赖时，在可能的情况下选最新稳定版本（不主动锁定旧版本），除非有明确的兼容性原因需要降级（需在 commit / 注释中说明原因）。
- **优先用脚手架生成，而非手写**：凡是有官方或社区脚手架/CLI 的场景，先用工具生成再按需修改，不要从零手写样板代码。例如：
  - 项目初始化：`create-next-app`（而不是手动搭 Next.js 项目结构）。
  - shadcn/ui 组件：`npx shadcn add <component>`（而不是手写 Button/Card/Dialog 等基础组件）。
  - PWA 配置：`@serwist/next` 提供的初始化命令/模板（而不是手写 service worker 注册逻辑）。
  - 其他类似场景（如 `idb` 的 schema 初始化、Tailwind 配置）同理，优先用官方推荐的初始化方式起步，再针对项目需求调整。

## 目录结构约定

```
src/
  app/                    // Next.js App Router：页面 + Route Handler
    api/today/route.ts    // Phase 2
    api/history/route.ts  // Phase 2
    page.tsx, layout.tsx
    *.test.tsx            // 页面级测试与被测文件同目录
  components/
    ui/                   // shadcn/ui 生成的组件，用 `npx shadcn add` 管理，不手改内部实现
    *.tsx                 // 手写的业务/布局组件（theme-provider、theme-toggle、后续的 rate-card、chart 等）
  lib/
    utils.ts              // shadcn 生成的 cn() 等工具
    *.ts                  // 业务逻辑模块（时区/跨年处理、周末补值与空档判定、cheerio 解析、idb 封装等，Phase 2/3）
    *.test.ts             // 与被测模块同目录
    __fixtures__/         // cheerio 解析用的本地 HTML fixture（Phase 2 起）
```

- 测试文件与被测源文件同目录（`*.test.ts` / `*.test.tsx`），不单独建 `__tests__` 顶层目录。
- `src/components/ui/` 只放 shadcn 生成的组件，业务组件放在 `src/components/` 下、不进 `ui/` 子目录，保持"生成的" vs "手写的"边界清晰。
- 业务逻辑（尤其是「领域规则」里列的易错逻辑）放在 `src/lib/`，不要直接写在 Route Handler 或页面组件里，方便单测覆盖。

## 迭代工作流（分阶段执行）

本项目按「阶段」（phase）迭代推进，每个阶段是一个可独立验收的最小交付单元（大致对应 `docs/blueprint.md` 第 13 节的顺序，但可按实际情况拆分/合并，例如"脚手架初始化"、"`/api/today` + `/api/history` 实现"、"IndexedDB 封装"、"首页 UI"、"PWA + 主题接入"）。阶段计划、进度索引统一放在 `docs/plans/`：

```
docs/plans/
  README.md              // 阶段索引：一行一条，阶段名 + 状态 + 完成日期 + 一句话结论
  phase-01-scaffold.md    // 当前/历史阶段的详细计划文档（完成并归档后可删除正文，只留索引里的摘要）
  ...
```

### 阶段生命周期

1. **阶段开始 — 制定计划**
   - 新建 `docs/plans/phase-N-<slug>.md`，至少包含：目标与范围（features）、明确排除的 non-goals、测试计划、验收标准（checklist）、任务拆分。用 TaskCreate 把任务拆分同步建出来。
   - 计划内容需先对照 `docs/blueprint.md` 和本文件的「架构红线」「领域规则」自查，确认不冲突；如需突破红线，暂停并向用户确认，不自行决定。
   - **同时复核后续阶段路线图是否依然合理**：结合本阶段和已完成阶段中获得的新信息（踩过的坑、发现的额外工作量、需求变化），检查 `docs/plans/README.md` 里排在后面的阶段划分、顺序、范围是否还站得住；不合理就当场重新组织（拆分/合并/调整顺序/增删阶段），并更新索引，不要机械地按最初设想的阶段清单往下走。
   - 计划本身不需要逐条等用户确认才能开始执行（除非涉及红线变更或有明显不确定性需要用户拍板）。
2. **自主执行**
   - 在已定计划范围内，可以连续自主执行多步（写代码、跑测试、调整实现），不必每一步都停下来确认；用 TaskUpdate 维护任务状态。
   - 涉及破坏性操作、超出本阶段计划范围的架构决策、引入新的外部依赖服务（数据库、第三方 API key 等）时，仍按全局安全约定暂停，向用户确认。
3. **阶段验收（结束前必须过）**
   - `pnpm lint` / `pnpm typecheck` / `pnpm build` 全部通过。
   - `pnpm test`（vitest）全部通过；本阶段新增的业务逻辑，尤其是「领域规则」里列出的时区/跨年/周末空档等逻辑，必须有对应单测覆盖，不能只靠人工检查。
   - 涉及 UI/交互变化的阶段：`pnpm test:e2e`（Playwright）全部通过，本阶段新增/改动的关键用户路径要有对应 e2e case（见「测试规范」）；此外仍建议本地起 `next dev` 用浏览器走一遍改动（含亮/暗主题），把 e2e 断言覆盖不到的纯视觉效果（间距、动效是否顺眼等）过一遍。
   - 逐条对照阶段计划文档里的验收标准打勾，未达成的不算阶段完成，回到"自主执行"继续处理。
4. **阶段收尾 — 文档清理与归档**
   - 把阶段计划文档中仍有长期参考价值的内容迁移进对应的长期文档：
     - 架构/设计层面的结论（最终数据结构、API 约定、目录结构等）→ 更新 `docs/blueprint.md` 对应章节；如果实现细节已经和原始设计明显分叉、需要单独记录 as-built 架构，再新建 `docs/architecture.md`。
     - 新发现的约束、踩坑经验、领域规则 → 更新本文件（AGENTS.md）对应章节。
   - 迁移完成后，阶段计划文档正文若已无后续指导意义，直接删除，只在 `docs/plans/README.md` 留一行历史记录；不保留完整过程文档。
   - 用 git commit 记录（见下方「Git 规范」）。

### 测试规范

测试分两层，各司其职，不要互相替代：

**单元测试（vitest）**

- 默认测试框架 vitest（遵循用户全局 CLAUDE.md 约定）。
- 优先覆盖领域规则中容易出错的纯逻辑：时区/跨年拼接、周末补值与空档判定、IndexedDB upsert 与空档查询、cheerio 解析函数。
- 抓取解析函数（cheerio 选择器）用本地保存的 HTML fixture 测试，不在测试/CI 中直接请求 `kylc.com`，避免测试脆弱、也避免给源站增加压力。
- 测试文件与被测源文件同目录（见「目录结构约定」），不进 `e2e/`。

**端到端测试（Playwright，`e2e/` 目录，`pnpm test:e2e` 运行）**

- 覆盖真实浏览器里的关键用户路径：加载首页看到购汇价卡片、切换时间范围（7 天/30 天/全部）、切换主题（亮/暗/跟随系统）、下拉刷新、离线状态下展示已缓存数据等。
- **必须用 `page.route()` mock 掉 `/api/today`、`/api/history` 的响应**，不依赖真实网络或 `kylc.com`——原因和单测里不直接请求源站一致：避免测试脆弱、避免拖慢/污染源站，也让空档/跨年等边界场景可以用固定 mock 数据稳定复现（否则依赖当天真实数据，边界场景很难测到）。
- Playwright 配置（`playwright.config.ts`）已配好 `webServer`，理论上跑 `pnpm test:e2e` 会自动拉起 `next dev` 并等待就绪，不需要手动先起 dev server。**已知问题**：在某些环境下（本项目开发过程中遇到过），Playwright 自己 spawn 的 dev server 会在首次编译时卡死不返回，但手动先跑 `pnpm dev`、等它就绪后再跑 `pnpm test:e2e`（这时 Playwright 会复用已有的 server）每次都稳定。没有完全定位到根因（怀疑是沙箱环境下的进程/端口状态问题，不是应用本身的缺陷——同样的 mock 逻辑对着手动起的 server 反复验证过都是对的）。`pnpm test:e2e` 卡住不返回时，直接用这个手动预热的方式绕过去，不用继续深挖。
- 当前只跑 Chromium 一个浏览器项目（个人项目，不需要跨浏览器矩阵）；如果以后发现要覆盖 Safari 特有的 PWA/离线行为，再按需加 webkit 项目。
- 从 Phase 4（首页 UI）开始，每个改动用户可见路径的阶段都要新增/更新对应 e2e case，作为该阶段验收标准的一部分；Phase 1-3（脚手架/API/IndexedDB）没有面向用户的 UI，暂不强制写 e2e，用单测覆盖即可。

### Git 规范（在用户全局 Conventional Commits 约定之上补充）

- **阶段内的 commit 可以自主创建**，无需每次都找用户确认——这是本文档对"仅在用户明确要求时才 commit"这一全局默认规则的一次性、限定范围的授权，只适用于本项目里符合本工作流的阶段内 commit。
- 阶段收尾的文档迁移/清理单独一个 commit，message 形如 `docs(<scope>): consolidate phase N docs into blueprint/AGENTS`。
- `git push` 仍需用户显式确认，不在自动授权范围内（推送涉及远端共享状态，风险等级不同于本地 commit）。
- 每个阶段建议对应一组逻辑清晰的 commit（不强制 one-phase-one-commit），但避免把多个阶段的改动混进同一个 commit。

## 实现前必读

新起一个功能或改动架构相关内容前，先确认是否与 `docs/blueprint.md` 的「架构红线」冲突；如果要突破红线（例如加服务端存储），先跟用户确认，不要自行决定。
