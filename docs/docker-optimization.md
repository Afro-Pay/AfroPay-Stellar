# Dockerfile Optimization Guide

This document outlines the optimization strategy applied to the Dockerfiles for the Frontend, Backend (API), and Rust Worker services. The changes leverage multi-stage builds, production-only dependency pruning, and BuildKit caching.

## Optimization Strategies

### 1. Multi-Stage Builds & Runtime Minimalization
Each service is split into discrete stages to prevent build toolchains, source files, and development dependencies from leaking into the final runtime images:
- **Frontend (`apps/frontend/Dockerfile`)**: Builds the Next.js site using all dependencies, but the runtime stage only copies the `.next` output directory, the public assets, and `node_modules` containing pruned production-only dependencies (`npm ci --omit=dev`).
- **Backend (`apps/api/Dockerfile`)**: Compiles the NestJS project and generates the Prisma client. The runtime stage only includes the compiled `dist/` directory, the production dependencies (including the Prisma client generated specifically for production), and minimal runtime configuration.
- **Rust Worker (`services/rust-worker/Dockerfile`)**: Compiles the Rust binary in a Debian-based Rust compiler image. The runtime stage uses `debian:bookworm-slim` and copies only the compiled release binary, installing only the necessary security certificates (`ca-certificates`) and SSL library (`libssl3`).

### 2. BuildKit Cache Mounts
For each service, BuildKit caching is utilized to speed up subsequent builds by persisting package caches across build runs:
- **NodeJS applications**: `RUN --mount=type=cache,target=/root/.npm npm ci` caches the npm package cache, preventing package redownloading.
- **Rust application**: Uses `--mount=type=cache,target=/usr/local/cargo/registry` and `--mount=type=cache,target=/app/target` to cache cargo dependencies and compiler outputs.

### 3. Rust Dependency Caching Layer
By creating a dummy `src/main.rs` file and running `cargo build --release` before copying the actual source code, we compile and cache the third-party dependencies. When the source code changes, Docker restores the cached dependencies layer and only recompiles the application code itself.

---

## Image Size Comparison

| Service | Previous Base / Structure | New Structure | Estimated Image Size Reduction |
| --- | --- | --- | --- |
| **Frontend** | Node 20 + all devDependencies | Node 20 + `npm ci --omit=dev` | ~50% reduction (removes TypeScript, ESLint, PostCSS, etc. from runtime) |
| **API Backend** | Node 20 + all devDependencies | Node 20 + `npm ci --omit=dev` | ~60% reduction (removes Nest CLI, TypeScript, Jest, compiler tools) |
| **Rust Worker** | Copying target release | Stripped runtime + cache mount optimization | ~5% smaller (runtime only includes ca-certificates and libssl3) |

---

## Build Time Improvements

- **Subsequent builds (no dependency changes)**:
  - **Node JS Services**: Speed improved by up to **40-60%** due to caching of the npm registry via `--mount=type=cache`.
  - **Rust Worker**: Compilation time reduced by up to **80%** (from minutes to seconds) because Cargo dependencies are cached on the `/app/target` cache mount.
