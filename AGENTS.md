# AGENTS.md — 工商银行澳币汇率 PWA

## 入口与当前架构

- [技术方案](docs/blueprint.md)是领域规则、数据和 API 契约的主要说明位置；修改业务前阅读相关章节并核对实现。
- [README](README.md)维护操作命令，[阶段工作流](docs/phase-workflow.md)维护执行与验收规则。
- 正在按[重构计划](docs/plans/vite-react-workers-migration.md)迁移至 Vite + React + Workers；状态见[进展](docs/progress/vite-react-workers-migration.md)。未完成替换前，Next.js + OpenNext 仍是当前实现，不迁移 vinext。

## 不可破坏的边界

- Cloudflare 单平台；独立 Cron 采集，网站 API 只读 D1。打开、刷新、唤醒或空库不得触发源站抓取，不提供公开强制采集入口。
- D1 是权威数据，IndexedDB / SW 为离线副本。保留分钟幂等、revision + write_id 原子写入，不引入租约锁或逐轮 D1 诊断写入；详情见技术方案。
- 不擅自引入 KV、Queues、Durable Objects 等业务服务，不调整账户套餐。
- 不自动清库。协议不兼容先验证兼容快照再原子重建本地副本；普通错误或报价 revision 改变不得触发清空。保留服务端历史、新版程序资源及有效回退依据。
- 生产发布先迁移、检查兼容性及初始化，再发布 collector 和网站；失败停止。build / 本地 preview 不操作生产。无法迁移的重建须可恢复备份及显式操作。
- 用户已授权 Cloudflare 正式部署及必要资源创建；阶段范围内可本地提交。`git push` 仍需明确授权，不把本地通过描述为线上验证。

## 实现约束

- TypeScript、pnpm；业务逻辑放 `src/lib/`，按领域、共享契约、客户端和服务端分层；单测与源文件同目录，fixture 本地化，不请求源站。
- Base UI + Tailwind；基础组件按需用 CLI 生成，位于 `src/components/ui/`。图表沿用 Chart.js，IndexedDB 沿用 idb，SW 沿用 Serwist 及对应集成的 defaultCache。
- 当前 JSON 现价与部署前 Node 历史校准的边界见技术方案；Cron 不导入历史 HTML 解析依赖，旧现价解析器不自动回退。
- binding 类型从 Wrangler 配置生成；浏览器、SW、网站 Worker、collector、Node 脚本区分环境，不手写复制 Env。
- 只跟随系统亮暗主题。同步中保留已有值和结构，使用行内提示；图表返回前台主动 resize。
- 同时为 flex 子元素与容器时默认加 min-h-0；Chart.js 旁不条件添加占布局空间的 flex 说明，避免画布抖动。
- 新依赖选适配的稳定版；有兼容性原因保留旧版时注明。不要在迁移中顺便扩展业务或重做交互。

## 当前 Next.js 约束（替换完成后删除）

- 写 Next.js 代码前阅读 `node_modules/next/dist/docs/` 的对应版本指南，注意异步 API 和弃用说明。
- Serwist 使用 @serwist/next；dev / build 必须保留 --webpack，不能仅靠 disable 消除 Turbopack 冲突。
- Cloudflare 本地上下文仅开发阶段初始化；完整 OpenNext 构建用于平台验证，标准 Next 构建不等于部署验证。
- viewport.themeColor 定义亮暗浏览器主题色，manifest 仅静态主题色；布局约束见技术方案。
- SW 与 collector 使用独立 tsconfig；根 tsconfig 排除两者。当前全部检查命令见 README。
