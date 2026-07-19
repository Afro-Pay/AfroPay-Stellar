# Contributing to AfroPay-Stellar
 
Thank you for contributing to AfroPay-Stellar — a cross-border remittance platform built on the Stellar blockchain, focused on fast, affordable payments across Africa and emerging markets.
 
This guide covers everything you need to open an issue, write code, run tests, and submit a pull request. Read it once before you start; it will save you revision cycles.
 
---
 
## Table of Contents
 
- [Code of Conduct](#code-of-conduct)
- [Project Overview](#project-overview)
- [Getting Started](#getting-started)
- [Opening Issues](#opening-issues)
- [Branch Naming](#branch-naming)
- [Development Workflow](#development-workflow)
- [Commit Messages](#commit-messages)
- [Testing Requirements](#testing-requirements)
- [Code Standards](#code-standards)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Review Expectations](#code-review-expectations)
- [Security](#security)
- [Good First Issues](#good-first-issues)
- [Resources](#resources)
---
 
## Code of Conduct
 
By participating in this project you agree to:
 
- Be respectful and constructive in all interactions
- Avoid harassment, spam, or discriminatory language
- Give and receive feedback professionally
- Support an inclusive environment for contributors of all backgrounds and skill levels
Violations can be reported to the maintainers directly via a private GitHub issue.
 
---
 
## Project Overview
 
AfroPay-Stellar is a **polyglot microservices** system. Before contributing, orient yourself to the stack:
 
| Service | Language | Role |
|---|---|---|
| `apps/frontend` | TypeScript / Next.js | UI — wallet views, send forms, dashboard |
| `apps/api` | TypeScript / NestJS | API gateway — auth, wallet, transfers, anchors |
| `services/rust-worker` | Rust | Stellar transaction engine |
| `services/python-analytics` | Python | Fraud detection and risk scoring |
| PostgreSQL + Prisma | — | Source of truth for all application state |
| Redis / BullMQ | — | Async job queue between API and Rust worker |
 
Full architecture: [docs/architecture.md](docs/architecture.md)
API reference: [docs/api-reference.md](docs/api-reference.md)
 
---
 
## Getting Started
 
### Prerequisites
 
| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| Docker & Docker Compose | Latest stable |
| Rust | Latest stable (`rustup update`) |
| Python | ≥ 3.10 |
 
### Fork and clone
 
```bash
# 1. Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/AfroPay-Stellar.git
cd AfroPay-Stellar
 
# 2. Add upstream so you can pull future changes
git remote add upstream https://github.com/Fury03/AfroPay-Stellar.git
```
 
### Start with Docker (recommended)
 
```bash
cp .env.example .env      # edit values as needed
docker compose up --build
```
 
Services:
- Frontend → http://localhost:3000
- API → http://localhost:3001
- Fraud service → http://localhost:8000
### Start without Docker
 
```bash
# API
cd apps/api
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
 
# Frontend (separate terminal)
cd apps/frontend
npm install
npm run dev
```
 
---
 
## Opening Issues
 
Use the correct issue template — GitHub will prompt you to choose one when you click **New Issue**:
 
| Template | When to use |
|---|---|
| **Bug Report** | Something is broken or behaving incorrectly |
| **Feature Request** | You want to propose new functionality |
| **Documentation** | Something is missing, unclear, or wrong in the docs |
 
### Before opening an issue
 
1. Search existing open **and closed** issues — it may already be reported or resolved.
2. For bugs, confirm the problem is reproducible on the `main` branch.
3. For features, check the [roadmap in README.md](README.md#roadmap) — it may already be planned.
### Issue title format
 
Follow the same prefix as commit messages:
 
```
fix: wallet balance not updating after transfer
feat: add multi-signature wallet support
docs: anchor integration guide is missing env var list
```
 
### Labels
 
Maintainers will triage and apply labels. Common ones:
 
| Label | Meaning |
|---|---|
| `bug` | Confirmed defect |
| `enhancement` | New feature or improvement |
| `good first issue` | Suitable for new contributors |
| `help wanted` | Maintainers welcome external help |
| `documentation` | Docs-only change |
| `needs-triage` | Awaiting maintainer review |
| `blocked` | Waiting on another issue or PR |
 
---
 
## Branch Naming
 
All branches must follow this convention:
 
```
<type>/<short-description>
```
 
| Type | Use for |
|---|---|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation changes |
| `refactor/` | Code restructuring with no behaviour change |
| `test/` | Adding or updating tests only |
| `chore/` | Build scripts, CI, dependency updates |
 
**Examples:**
 
```bash
feat/multi-sig-wallet
fix/anchor-withdrawal-timeout
docs/improve-readme
refactor/transaction-service-queue
test/anchor-service-fx-cache
chore/upgrade-stellar-sdk-v12
```
 
Rules:
- Use **lowercase and hyphens** — no underscores, no spaces, no uppercase
- Keep descriptions short (3–5 words)
- Branch off `main` unless a maintainer specifies otherwise
```bash
git checkout main
git pull upstream main
git checkout -b feat/your-feature
```
 
---
 
## Development Workflow
 
```
main
 └── feat/your-feature      ← your branch
      └── commits
           └── PR → main
```
 
1. **Always branch from `main`** after pulling the latest.
2. **Keep your branch focused** — one issue or feature per branch.
3. **Sync regularly** if your branch lives for more than a day:
```bash
git fetch upstream
git rebase upstream/main
```
 
4. **Never push directly to `main`** — all changes go through PRs.
---
 
## Commit Messages
 
Follow [Conventional Commits](https://www.conventionalcommits.org/):
 
```
<type>(<scope>): <short description>
 
[optional body]
 
[optional footer: Closes #123]
```
 
### Types
 
| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace (no logic change) |
| `refactor` | Restructuring without feature or fix |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependencies |
 
### Scopes (optional but encouraged)
 
Use the service or module name: `wallet`, `transaction`, `anchor`, `auth`, `frontend`, `rust-worker`, `analytics`, `docker`, `prisma`.
 
### Examples
 
```bash
feat(wallet): add AES-256 key rotation for encrypted secrets
fix(anchor): handle null rate_expires_at on cache miss
docs(readme): add Docker service port reference table
test(transaction): add batch simulation spec for NGN→USDC path
chore(deps): upgrade stellar-sdk to v12
refactor(auth): extract JWT strategy into standalone module
```
 
Rules:
- Use the **imperative present tense**: "add", not "added" or "adds"
- Keep the subject line under **72 characters**
- Reference the issue in the footer: `Closes #42`
---
 
## Testing Requirements
 
All PRs that touch application logic **must include tests**. PRs that add no tests for new behaviour will be asked to add them before merge.
 
### Running tests
 
```bash
# Run all API tests
cd apps/api
npm test
 
# Run a single spec file
npm test -- transfer-simulation.service.spec.ts
npm test -- wallet.service.spec.ts
npm test -- anchor.service.spec.ts
 
# Lint (must pass before PR)
npm run lint
 
# Build check (must pass before PR)
npm run build
```
 
### What to test
 
| Change type | Testing expectation |
|---|---|
| New service method | Unit test covering the happy path and at least one error/edge case |
| Transfer / payment logic | Test all path combinations (USDC→NGN, XLM→NGN, XLM→USDC) and blocked paths (missing trustline, no path) |
| Anchor / FX logic | Test known rates, unknown pairs, cache TTL behaviour, and cache invalidation on rate delta > 0.5% |
| Wallet / encryption | Test encrypt→decrypt round-trip and that ciphertext differs across calls (random IV) |
| Bug fix | Add a test that **fails before** your fix and **passes after** |
| Refactor | Existing tests must continue to pass — add no regressions |
| Docs / chore | No test required |
 
### Test patterns used in this project
 
Tests live alongside their source file as `*.spec.ts`. They use **Jest + ts-jest** with no database — services are instantiated directly with null dependencies where persistence is not under test.
 
```typescript
// Pattern: instantiate the service directly, mock heavy deps
describe('AnchorService', () => {
  let service: AnchorService;
 
  beforeEach(() => {
    service = new AnchorService();
  });
 
  it('returns a known FX rate for USD-NGN', async () => {
    const result = await service.getFxRate('USD', 'NGN');
    expect(result.rate).toBe(1550);
  });
});
```
 
Follow the same pattern when adding tests. Do not introduce database or network calls in unit tests — mock or stub external dependencies.
 
---
 
## Code Standards
 
### TypeScript (API & Frontend)
 
- **Strict TypeScript** — no `any` unless genuinely unavoidable; comment why if used
- Use `class-validator` decorators on all DTOs
- Keep NestJS modules, services, and controllers in separate files
- Use `async/await` — no raw Promise chains
- No `console.log` in committed code — use NestJS `Logger`
- Follow the existing folder structure: one folder per domain (`auth/`, `wallet/`, `transaction/`, `anchor/`)
### Rust (rust-worker)
 
- Run `cargo fmt` before committing
- Run `cargo clippy` — fix all warnings
- No `unwrap()` in production paths — use `?` or explicit error handling
### Python (python-analytics)
 
- Follow PEP 8
- Type-annotate all function signatures
- Run `flake8` before committing
### General
 
- No private keys, secrets, or `.env` files committed — ever
- No commented-out code left in PRs
- Keep functions and methods small and single-purpose
- Update relevant documentation when behaviour changes
---
 
## Submitting a Pull Request
 
### Before opening the PR
 
```bash
# 1. Sync with upstream
git fetch upstream
git rebase upstream/main
 
# 2. Run tests — must pass
cd apps/api && npm test
 
# 3. Lint — must pass
npm run lint
 
# 4. Build — must pass
npm run build
 
# 5. Push your branch
git push origin feat/your-feature
```
 
### Opening the PR
 
1. Go to the repository on GitHub
2. Click **Compare & pull request** (GitHub shows this after a push)
3. Set **base branch** to `main`
4. Fill in the PR template — every section matters
5. Link the issue: write `Closes #<issue-number>` in the Summary section
6. Submit — a maintainer will be assigned to review
### PR scope rules
 
- **One concern per PR.** A PR that fixes a bug AND adds a feature will be asked to split.
- **Keep diffs small.** PRs under 400 lines of change are reviewed faster.
- **Draft PRs are welcome** for early feedback — mark them ready when tests pass.
---
 
## Code Review Expectations
 
### For contributors (PR author)
 
- Respond to review comments within **3 business days** — if you need more time, say so
- Do not resolve threads opened by a reviewer — let the reviewer resolve after they are satisfied
- Push fixes as **new commits** during review (not force-pushed rewrites) so reviewers can see what changed
- Once all threads are resolved and CI passes, re-request review
### For reviewers
 
Reviewers check for:
 
| Area | What reviewers look at |
|---|---|
| **Correctness** | Does the code do what the PR description claims? |
| **Tests** | Are new behaviours covered? Do existing tests still pass? |
| **Security** | No exposed secrets, keys, or unvalidated inputs |
| **Stellar safety** | Transaction submissions guarded by simulation; trustlines checked before transfer |
| **Code style** | Follows project conventions; no lint warnings |
| **Scope** | PR is focused; no unrelated changes bundled in |
| **Documentation** | Relevant docs updated if behaviour changed |
 
Reviews use this vocabulary:
 
- **Must fix** — blocking; the PR cannot merge without addressing this
- **Should fix** — strongly encouraged but not a hard blocker
- **Nit** — minor style or preference; author can use their judgement
- **Question** — reviewer is asking for clarification, not requesting a change
### Merge criteria
 
A PR is ready to merge when:
 
- [ ] At least **1 approving review** from a maintainer
- [ ] All **Must fix** comments are resolved
- [ ] All CI checks pass (lint, build, tests)
- [ ] No merge conflicts with `main`
Maintainers merge using **Squash and merge** to keep the `main` history linear.
 
---
 
## Security
 
**Never commit:**
- Private keys or mnemonics
- JWT secrets or encryption keys
- `.env` files or any file containing credentials
- Stellar secret keys (`S...` format)
If you discover a security vulnerability, **do not open a public issue**. Report it privately by opening a GitHub issue marked **confidential**, or contact the maintainers directly.
 
For Stellar-specific safety:
- Always run `TransferSimulationService.simulate()` before submitting a live transaction
- Validate trustlines before any asset transfer
- Test all transaction flows on **testnet** before targeting mainnet
---
 
## Good First Issues
 
New to the project? Look for issues labelled:
 
- `good first issue` — scoped, self-contained tasks
- `help wanted` — maintainers are actively looking for contributors
- `documentation` — a great starting point with no risk of breaking production
If nothing fits, feel free to open a **Documentation** issue for something you found confusing while reading this guide — that is a real and valued contribution.
 
---
 
## Resources
 
| Resource | Link |
|---|---|
| Stellar Developer Docs | https://developers.stellar.org/docs |
| Stellar SDK (JavaScript) | https://developers.stellar.org/docs/tools/sdks/client-sdks/javascript |
| Stellar Testnet Faucet | https://friendbot.stellar.org |
| Stellar Laboratory | https://laboratory.stellar.org |
| Soroban Smart Contracts | https://developers.stellar.org/docs/build/smart-contracts |
| NestJS Docs | https://docs.nestjs.com |
| Prisma Docs | https://www.prisma.io/docs |
| BullMQ Docs | https://docs.bullmq.io |
| Conventional Commits | https://www.conventionalcommits.org |
| Project Architecture | [docs/architecture.md](docs/architecture.md) |
| API Reference | [docs/api-reference.md](docs/api-reference.md) |
| Integration Guide | [docs/integration.md](docs/integration.md) |
 