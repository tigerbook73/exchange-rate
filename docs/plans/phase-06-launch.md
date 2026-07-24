# Phase 6 — 本地全流程测试 + 部署 Vercel 真机验证

## 目标与范围

- 本地对生产构建做一次完整回归：lint/typecheck/test/e2e/build 全过。
- 移动端视口下（375–430px）走查首页排版，确认响应式没问题。
- 模拟"多天未打开 App"场景，验证 >28 天不可恢复空档的 UI 呈现（断线）符合预期。
- PWA 可安装性检查（manifest 字段完整性、图标、SW 注册）。
- 部署到 Vercel，真机验证。

## Non-goals

- 不引入 Lighthouse CI 等额外工具，手动检查 PWA 安装条件即可（个人项目，不需要长期 CI 门禁）。
- 不做跨浏览器矩阵测试（Safari/Firefox），只验证 Chromium（移动端最常见内核 + 项目 e2e 既有约定）。

## 已知需要用户参与的部分

- **推送到 GitHub**：需要确认仓库名称/可见性（本环境 `gh` 已登录 `tigerbook73`，可以创建仓库并推送，但推送是对外可见的动作，需要用户确认后才做）。
- **Vercel Import Project**：这一步通常要在 Vercel 网页控制台里用用户自己的账号操作（选仓库、确认框架识别），本环境没有 Vercel CLI/token，无法代为完成；只能提供操作指引。
- **Vercel 构建命令确认**：因为 Phase 5 发现 `next build` 默认 Turbopack 和 `@serwist/next` 冲突，`package.json` 的 `build` 脚本已经改成 `next build --webpack`，Vercel 默认会执行 `pnpm build`（读 package.json 的 build 脚本），理论上不需要额外配置，但部署后要用真实构建日志确认。

## 验收标准

- [ ] `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:e2e` / `pnpm build` 全过
- [ ] 375px 视口下首页无横向滚动、无遮挡
- [ ] 模拟本地空档 > 28 天的场景，图表正确断线，不做插值
- [ ] Chrome DevTools 里 manifest 面板无报错、Service Worker 面板显示已激活
- [ ] Vercel 部署成功，线上真实域名下手机浏览器验证：可安装到主屏幕、断网后重新打开可用、下拉刷新可用
