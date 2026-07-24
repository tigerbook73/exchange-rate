# 工商银行澳币汇率 PWA

展示中国工商银行「澳大利亚元」现汇卖出价（购汇价）的当日报价与历史趋势，纯客户端存储，无后端持久化。

- 技术方案：[`docs/blueprint.md`](./docs/blueprint.md)
- Agent 协作约束与迭代工作流：[`AGENTS.md`](./AGENTS.md)
- 阶段进度：[`docs/plans/README.md`](./docs/plans/README.md)

## 开发

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 常用脚本

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm format        # Prettier 写入
pnpm format:check  # Prettier 检查
pnpm test          # vitest run
pnpm build         # next build
```
