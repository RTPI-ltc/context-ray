# Security policy

## Supported versions

Before the first public release, only the current `main` branch is supported.

## Reporting a vulnerability

Do not open a public issue for a suspected credential leak, path escape, command-execution flaw, report injection, or CI permission problem. After a project security contact is configured, report privately through that channel with:

- affected version or commit;
- minimal reproduction;
- expected and observed trust boundary;
- impact and any known workaround.

Until a private contact exists, keep the report local and notify the repository owner directly through an agreed private channel. This file intentionally does not publish an unconfigured email address.

## Scope priorities

High-priority issues include repository-root or symlink escape, unintended command execution, unredacted secrets in reports, unsafe standalone HTML injection, and GitHub Action credential exposure.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the security model and non-goals.
