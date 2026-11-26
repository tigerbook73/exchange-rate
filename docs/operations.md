# 运维备忘

供按需排查使用，不要求持续监控、固定观察周期或恢复演练；涉及 Worker 热路径 / 运行时依赖的发布按需查看 CPU 和 D1 用量，确认 Cloudflare Free 适配。操作见 [README](../README.md)。

## 已知状态

- 正式入口 https://icbc-rate.tigerbook.top ，资源目标以 Wrangler 配置为准。2026-11-23 手动部署记录：网站 `932b169d-44bd-498d-9aca-af020c1d4d1f`，collector `d6056f8c-7739-4983-8640-55de9a61e90a`；D1 已应用 0001–0005，schema 1。此后有 Git 推送，这些版本不代表重新核实后的当前线上版本。
- Cloudflare Git 触发发布曾验证成功，Builds trigger 查询曾返回 403；控制台详细配置未读取。只在排查自动部署时跟进。
- 新现价 JSON API 稳定性尚待使用中观察，旧 HTML 解析器及配套依赖继续保留，不自动回退。
- 原设备图表拖影未确认解决，暂不扩展修复；源站失败或延迟出现实际影响时再排查；CPU / 免费额度适配不等到用户受影响才检查。继续全天采集，不根据未验证的休市时间缩短窗口。

## 价格提醒部署

2026-11-26 已应用增量迁移 `0006_price_alerts.sql` 并通过生产数据检查，schema 仍为 1；发布网站 `24f3d8af-10b9-496d-82e7-9552e5cff13d`、collector `07ea2c81-250b-44fd-8fb5-bcfe47f66398`。两个 Worker 已配置 VAPID Secret，网站另配置邀请码。发布前备份为 `.wrangler/backups/2026-11-26-before-price-alerts.sql`。

本地验证通过 Workerd 加密 / 签名、旧 SW 升级、本地数据保留及 Chromium 模拟 push 显示；正式手机接收及实际推送发送轮次 CPU 需在设备加入后确认。无设备时的 Cron 指标不能代替推送负载指标。免费计划适配继续按实际 CPU / D1 用量判断，不因推送本身免费而承诺无限订阅。

## 恢复依据

- 旧 R2 `icbc-rate-opennext-cache` 仅供旧框架回退，新代码不使用；暂不删除。Vercel 已不作为部署目标，未操作其控制台资源。
- 已有 D1 备份：`.wrangler/backups/2026-11-23-before-vite.sql`、`2026-11-22-before-icbc-api.sql`、`2026-11-22-initial-production.sql`（后两份同目录）。均为本地忽略文件，长期需要时另行保管。
- 迁移验证 / 旧构建证据：`.wrangler/vite-production-verification.json`、`.wrangler/migration-baseline/`，同样不纳入 Git。
- 可参考的主题修复版本如下；真正回退前先确认版本及其资源仍存在。代码回滚不回滚 D1，客户端缓存需另行检查，不自动导入备份。

```bash
pnpm exec wrangler rollback 79ba5a65-f1dd-4ecb-8088-6c27e0213ff4 --name icbc-rate
pnpm exec wrangler rollback 4b62a80d-045d-434e-8674-e9e16c09f834 --config collector/wrangler.jsonc
```
