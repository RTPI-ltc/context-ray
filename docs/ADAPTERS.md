# Agent adapter behavior

The table below describes implemented repository-scoped behavior. “Observed” means a repository file proves the fact. “Inferred” means official product behavior and available metadata support the conclusion, but the agent's final private request is not visible.

| Agent          | Primary sources                                                                          | Implemented behavior                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex          | `AGENTS.override.md`, `AGENTS.md`, configured fallbacks, `.codex/config.toml`            | Walk root to target, select first non-empty candidate per directory, mark siblings shadowed, concatenate deeper guidance later, honor `project_doc_max_bytes` |
| Claude Code    | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules`, `.claude/skills`   | Load hierarchy, resolve local `@` imports to depth five, apply `paths` frontmatter, mark skills on-demand                                                     |
| Cursor         | `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules`, `.cursor/skills`              | Apply `alwaysApply` and glob rules, label description-triggered rules as inferred/conditional, mark skills on-demand                                          |
| GitHub Copilot | `.github/copilot-instructions.md`, `AGENTS.md`, `.github/instructions/*.instructions.md` | Load repository instructions and apply `applyTo` path patterns; compatibility files are conditional where surfaces differ                                     |
| Gemini CLI     | configured context filename, `GEMINI.md`, `.gemini/settings.json`, `.gemini/skills`      | Walk root to target, resolve local imports, mark skills on-demand                                                                                             |

## MCP sources

Each adapter checks its documented project configuration plus `context-ray.mcp.json` and any explicit `--mcp-snapshot` path. Server declarations are conditional because declaration does not prove live availability. Tool schemas become active only when present in a supplied local snapshot.

The scanner never launches an MCP command. An `npx` declaration without a pinned version is reported separately.

## Hooks

Supported hook files are inventoried as conditional sources with zero token contribution. Static analysis does not execute them or speculate about their dynamic output.

## Known limits

- User-home and managed organization policies are not copied into reports. `--include-global` currently changes coverage disclosure but does not read home secrets.
- Cursor and Copilot behavior varies across editor, CLI, and agent modes; conditional compatibility sources use medium confidence when official behavior is not uniform.
- Token counts are deterministic estimates from `gpt-tokenizer`, not provider billing totals.
- Relevance is a lexical target/task heuristic, not a model judgment.
- The analyzer does not know provider-side system prompts, caching, tool filtering, or request rewriting.

## Source maintenance

Adapter changes should cite current official docs and add precedence/path fixtures. Current reference points:

- [Codex instruction discovery](https://developers.openai.com/codex/guides/agents-md)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [VS Code/Copilot custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)
- [Gemini CLI context files](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

Last reviewed: 2026-07-13.
