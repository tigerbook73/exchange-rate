# 运行状态与待办

更新日期：2026-11-23。架构契约见[技术方案](blueprint.md)，命令见 [README](../README.md)。本文件只保留当前运行状态、回退依据和开放事项，历史过程见 Git。

## 当前部署

| 项目       | 状态                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 正式入口   | https://icbc-rate.tigerbook.top                                                                            |
| 网站       | `icbc-rate`，Vite + React + 原生 Worker，版本 `79ba5a65-f1dd-4ecb-8088-6c27e0213ff4`                       |
| 采集       | `icbc-rate-collector`，版本 `4b62a80d-045d-434e-8674-e9e16c09f834`，每分钟 Cron                            |
| 实现提交   | main 已推送至 `f1adfa3`；主题闪白修复已手动部署并保存本地提交，尚未推送                                    |
| D1         | `icbc-rate` / `d6a2a857-d667-4344-a049-ee4457ddb4ee`；migration 0001–0005 已应用，本次无待执行 migration   |
| 数据兼容   | schema 1，datasetId `150f265f977693ec8da3ef1a0a192959` 保持不变；367 条服务端每日数据，API 默认窗口 366 条 |
| 资源边界   | 网站实际绑定仅 ASSETS / DB，collector 仅 DB；两者实际生产 D1 ID 已通过 REST 核对                           |
| 旧框架资源 | R2 `icbc-rate-opennext-cache` 保留供回退，新代码不使用；未删除远程资源                                     |

统一发布已完成构建、migration、现价 / 历史就绪检查，再依次发布 collector 与网站。构建包为网站 8.43KiB / gzip 2.94KiB、collector 15.15KiB / gzip 4.89KiB；这是 Worker 包大小，不含前端资源，也不代表运行性能。

## 已验证与证据

- 刷新主题修复：HTML 在应用 JS/CSS 到达前初始化主题及底色；本地生产预览 28 项页面 / PWA 用例通过，正式站的亮暗资源延迟、刷新主题及真实 SW 离线重载 4 项检查通过。页面 API mock 用例阻止 SW 接管，真实 SW 单独验证。
- 本地：格式、lint、浏览器 / 网站 / SW / collector / Node 工具及测试类型通过；91 项 Vitest（含隔离 D1）、27 项 Chromium 页面回归、生产 PWA 接管及离线重载通过；两个 Worker 打包通过。
- 升级：本地旧 Next PWA → Vite、Vite → Vite 更新均保留 IndexedDB / 游标并离线重载。正式站也使用发布前建立的持久浏览器状态验证真实旧版升级：datasetId 和 schema 不变，366 条本地每日数据保留，离线整页重载通过，页面错误 0；亮暗移动截图已检查。
- 生产 API：snapshot / delta、兼容 today / history、426 协议升级、409 游标重建、410 过期分时、未知 API 404 和方法 405 均通过。首页改为 /assets 资源，manifest 的 start_url / scope 保持根路径。
- 重构上线时 collector 在 `2026-11-23T03:06:20Z` 自然 Cron 成功，D1 记录真实采集成功。03:07 一轮源站失败保留最近报价，03:08、03:09 自然 Cron 已恢复，`lastError=null`、失败计数为 0；未清历史，持续稳定性仍需观察。
- 重构首轮 Analytics 的 collector CPU 字段 cpuTimeP50 为 5054，平台 errors 为 0；网站样本也无平台错误。样本有限，不能据此认定长期免费额度通过，源站失败与平台错误分别判断。
- 原始生产验证与指标：`.wrangler/vite-production-verification.json`；升级浏览器、截图和本地旧构建：`.wrangler/migration-baseline/`。均为本地忽略文件，不纳入 Git。长期需要的备份应另行保管。

## 回退依据

主题修复前已确认的版本：网站 `e79b875f-75a5-49e4-a938-5b253eabfc9e`，collector `2c9b8e70-408d-447c-81b2-912bf10123cc`。本次无数据库结构变更、清库或 schema 升级，回退前仍须确认这些版本可用及旧资源存在。

```bash
# 需要回退时显式执行；两者可分别操作，不自动回滚 D1
pnpm exec wrangler rollback e79b875f-75a5-49e4-a938-5b253eabfc9e --name icbc-rate
pnpm exec wrangler rollback 2c9b8e70-408d-447c-81b2-912bf10123cc --config collector/wrangler.jsonc
```

生产 D1 切换前备份 `.wrangler/backups/2026-11-23-before-vite.sql`（约 409KiB）；旧备份 `.wrangler/backups/2026-11-22-before-icbc-api.sql`、`.wrangler/backups/2026-11-22-initial-production.sql` 也保留。恢复属于显式操作，不自动导入生产；回滚代码不等于回滚数据，PWA 客户端已缓存资源也需单独验收。

用户已确认不再使用 Vercel，不作为后续部署或验收目标；本次未修改或删除其控制台资源。

## 开放事项

| 事项              | 当前状态与后续动作                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Builds | 两个 Worker 的 trigger GET 仍返回 403，未改控制台；`f1adfa3` 的 Git 触发构建与双 Worker 发布已验证成功；详细控制台配置仍无法读取，README 的目标设置不等于已读取实际设置 |
| 长期额度和缓存    | 继续观察 Cron / 网站 CPU、D1 用量、实际 CDN 命中；新代码不使用 R2，旧桶仍保留。不能因短期成功自动调整套餐或宣称全站免费达标                                             |
| 采集窗口          | 至少两周的时间分布观察未完成，继续全天采集，不硬编码周末或缩短窗口                                                                                                      |
| 恢复与回滚演练    | 备份已导出，尚未做破坏性的生产恢复或真实回滚演练；后续在隔离资源验证，不为验收重置生产                                                                                  |
| 旧兼容实现        | 旧现价 HTML 解析器仅显式比较，兼容 API / 本地旧缓存逻辑继续保留；无独立退役依据前不删除                                                                                 |
| 原设备图表拖影    | 原设备未确认解决，截图及自动化不足以确认成因；本次保持交互，不扩展修复范围                                                                                              |
| 旧资源清理        | 稳定并确认回退需求后再决定旧 R2 等资源退役；未自动删除                                                                                                                  |
