# Context Ray 中文说明

Context Ray 是一个本地优先的 Coding Agent 有效上下文分析器。它针对指定的仓库、Agent 和目标路径，解释哪些指令、路径规则、Skill、Hook、MCP Server 与工具 Schema 会生效，并给出冲突、上下文成本、安全风险、证据和可观测性边界。

它不会声称能读取模型服务商的内部 System Prompt、服务端 Prompt 改写、缓存或最终请求序列化结果。

## 目标用户

- 经常在 CLI 中使用 Codex、Claude Code、Cursor、Copilot 或 Gemini CLI 的开发者；
- 维护多仓库 Agent 配置、MCP 与工程规范的平台团队；
- 需要审查指令注入、权限边界、明文凭证和 CI 风险的安全或 DevEx 团队。

## 当前能力

- 支持 Codex、Claude Code、Cursor、GitHub Copilot、Gemini CLI 五种适配器；
- 输出终端、JSON、Markdown、SARIF 和单文件 HTML；
- 提供交互式 Dashboard、VS Code 扩展和 GitHub Action；
- Dashboard 的扫描、情景投影、源文件预览与导出由本地回环 API 或 VS Code 扩展主机执行，不使用演示数据兜底；
- 支持报告基线比较与严重级别门禁；
- 普通静态扫描绝不执行仓库脚本或启动 MCP 进程；
- `trace` 仅在用户显式给出命令时记录进程元数据。

## 本地运行

需要 Node.js 20.19+ 与 pnpm 11：

```bash
corepack enable
pnpm install
pnpm context-ray scan fixtures/sample-repo --agent codex --target services/payments
```

运行可重新扫描的交互式 Dashboard：

```bash
pnpm build
node packages/cli/dist/index.js serve fixtures/sample-repo --agent codex --target services/payments
```

随后打开 `http://127.0.0.1:4173/`。页面里的 Agent、Target、Task 和“Run scan”都会调用真实分析内核。通过 `scan --format html` 导出的单文件报告是可携带的只读快照；如需重新扫描、源文件预览或情景投影，应使用 `serve` 或 VS Code 扩展。

生成 JSON、SARIF 与 HTML：

```bash
pnpm context-ray scan . --agent claude --target packages/core --format json --output .context-ray/report.json
pnpm context-ray scan . --agent codex --format sarif --output .context-ray/report.sarif
pnpm build:dashboard
pnpm context-ray scan . --agent codex --format html --output .context-ray/report.html
```

完整命令和工程结构见根目录 [README](../README.md)。产品定位、架构、安全边界、适配器规则与开源组件决策分别见：

- [产品与目标人群](PRODUCT.md)
- [架构](ARCHITECTURE.md)
- [适配器](ADAPTERS.md)
- [安全模型](THREAT_MODEL.md)
- [开源组件评审](OPEN_SOURCE_REVIEW.md)

## 当前状态

当前版本是托管于 [RTPI-ltc/context-ray](https://github.com/RTPI-ltc/context-ray) 的 `0.1.0` 源码预发布版本，尚未发布 npm、VS Code Marketplace 或带标签的 GitHub Action。首次正式发布前仍需重新检查包名、发布者身份、版本、依赖许可和安全审计结果。

项目采用 [MIT License](../LICENSE)。
