# Product brief

## Problem

Coding agents assemble effective context from multiple independent mechanisms: hierarchical instructions, path rules, imported memory, skills, hooks, MCP declarations, and tool schemas. Users can inspect each file but cannot easily answer the operational questions that matter:

- What is actually active for this agent and target?
- Which source won when names or scopes overlap?
- How much startup context comes from each source?
- Which instructions conflict or appear unrelated to the task?
- Which MCP schemas are eagerly exposed and what could be discovered later?
- Which claims are repository evidence, adapter inference, or impossible to observe?

The problem is growing, not hypothetical. A 2026 study of 100 popular repositories found configuration smells were widespread, including lint leakage in 62%, context bloat in 42%, and skill leakage in 35% of the analyzed files ([dos Santos et al., 2026](https://arxiv.org/abs/2606.15828)). Separate work on real AI-enabled CI/CD workflows shows that configuration and credential boundaries create structural prompt-injection risk ([GitInject, 2026](https://arxiv.org/abs/2606.09935)).

## Product thesis

Context Ray should behave like a profiler, not another rules editor. It collects deterministic repository evidence once, models agent-specific loading behavior, and presents the same versioned report through CLI, dashboard, IDE, and CI.

The differentiator is **effective-context simulation with provenance**:

- choose agent + target + optional task;
- show active, conditional, on-demand, shadowed, truncated, and unavailable sources;
- attribute token estimates to source and tool schema;
- connect sources with loads/imports/overrides/declares edges;
- make every finding evidence-backed and confidence-labeled;
- disclose unobservable provider internals instead of filling gaps with guesses.

## Primary audiences

### 1. CLI-heavy coding-agent user

Works in several repositories and switches between Codex, Claude Code, Cursor, Copilot, or Gemini CLI. Needs a fast answer before starting an expensive or privileged session.

Job: “Before I ask the agent to work here, show me what guidance and tools it will probably see.”

### 2. Repository or platform maintainer

Owns shared instructions and MCP configuration across many teams. Needs a regression signal when a change increases context, creates a contradiction, or broadens permissions.

Job: “When agent configuration changes, tell reviewers how the effective context changed.”

### 3. Security and developer-experience reviewer

Needs evidence for path scope, remote imports, literal secrets, unpinned process launch, dangerous commands, and CI boundaries without running untrusted code.

Job: “Give me a static, reviewable inventory and make the blind spots explicit.”

## Core workflow

1. Select repository, agent, and target.
2. Discover supported repository sources without executing project code.
3. Apply the selected agent's documented discovery, precedence, and path rules.
4. Estimate tokens and relevance; import explicit MCP snapshots.
5. Produce findings, recommendations, coverage, and provenance edges.
6. Render the same report in terminal, JSON/SARIF/Markdown/HTML, VS Code, or CI.
7. Compare with a baseline before merging configuration changes.

## V1 success criteria

- A fresh user can scan a repository from source in under five minutes.
- All five adapters produce deterministic reports for the same inputs.
- Static scan launches zero repository commands.
- Every finding contains evidence, confidence, and a concrete recommendation.
- CLI JSON is sufficient to reproduce the Dashboard and IDE views.
- CI can fail on severity and publish SARIF without a separate service.
- The product labels provider internals as not observable.

## Non-goals

- Reproducing a provider's private system prompt or exact billed token count.
- Automatically rewriting agent instructions in V1.
- Starting arbitrary MCP servers during a normal scan.
- Replacing secret scanners, sandboxing, or code review.
- Synchronizing every agent's configuration into a single canonical syntax.

## Product risks

| Risk                                                    | Response                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Agent behavior changes faster than adapters             | Keep adapter fixtures, official source links, and confidence labels; version the report schema independently |
| Token estimate mistaken for billing truth               | Label all counts as estimates and expose the estimator boundary                                              |
| Static evidence mistaken for runtime truth              | Separate repository, global, runtime, MCP, and internal-prompt coverage                                      |
| Analyzer becomes an execution vector                    | Static by default; explicit runtime command; root containment; output escaping                               |
| Dashboard becomes the product instead of the data model | Keep schema/core packages UI-independent and render every surface from the same report                       |

## Research inputs

Official behavior was grounded in the product documentation for [Codex `AGENTS.md`](https://developers.openai.com/codex/guides/agents-md), [Claude Code memory and rules](https://code.claude.com/docs/en/memory), [VS Code/Copilot custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), [Gemini CLI context files](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md), and the [MCP tool specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

Security priorities also reflect current primary research on [configuration smells](https://arxiv.org/abs/2606.15828), [real CI/CD prompt injection](https://arxiv.org/abs/2606.09935), and [skill-based prompt injection](https://arxiv.org/abs/2602.14211). Research was last reviewed on 2026-07-13 and should be refreshed before a public release.
