# Threat model

## Assets

- repository source and configuration;
- credentials referenced by agent or MCP configuration;
- CI tokens and write permissions;
- report integrity and evidence provenance;
- user intent around whether any process may execute.

## Adversaries and inputs

Context Ray may scan an untrusted fork, pull request, dependency fixture, instruction file, skill, hook, or MCP declaration. Text inside those files is data, not an instruction to Context Ray.

## Defenses

### Path containment

Files are resolved with `realpath`; targets outside the repository root are rejected. Symlinks are recorded only when their resolved path remains inside the root. File reads are bounded.

### No implicit execution

Static scans do not execute package scripts, hooks, MCP commands, or agent CLIs. `trace` is intentionally separate and requires the full command from the user.

### Output safety

- Findings redact credential-like excerpts.
- Standalone HTML encodes report JSON before inserting it into a script.
- React renders source labels and evidence as text.
- SARIF and Markdown contain bounded excerpts, not full files.

### Honest observability

The report distinguishes repository evidence, inference, and state that cannot be observed. A configured MCP server is not reported as live. Runtime I/O is not parsed as a private prompt.

## Known risks

- Tokenization of a very large number of permitted files can consume CPU and memory.
- Heuristic secret detection can miss credentials or flag examples.
- A user can intentionally run an unsafe command through `trace`; Context Ray records but does not sandbox that command.
- A GitHub Action still executes with the workflow's permissions. Use read-only permissions unless SARIF upload requires more.
- Adapter drift can create false active/conditional labels until official behavior and fixtures are updated.

## CI guidance

Run on the checked-out source with minimal permissions. Do not expose write tokens to pull requests from untrusted forks. Upload SARIF in a separate least-privileged step when possible. Treat generated reports as potentially sensitive build artifacts.

Current research shows configuration-file prompt injection in AI-enabled CI/CD is a structural risk, not only a model problem; see [GitInject](https://arxiv.org/abs/2606.09935) and [SkillJect](https://arxiv.org/abs/2602.14211).
