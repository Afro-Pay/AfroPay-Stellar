# TODO - Rate limiter Redis distributed fix

## Step 1: Implement plan overview

- [x] Gathered info from README and existing rate-limit files

## Step 2: Update rate limit implementation

- [x] Replace in-process buckets with Redis-backed token-bucket/sliding-window
- [ ] Set X-RateLimit headers on every request

## Step 3: Module wiring

- [ ] Ensure Redis client is created/managed cleanly in RateLimitModule/guard

## Step 4: Update tests

- [ ] Rewrite rate-limit.guard.spec.ts to simulate two guard “instances” sharing Redis
- [ ] Ensure Redis keys are cleaned between tests

## Step 5: Kubernetes review

- [x] Reviewed deploy/kubernetes/api.yaml replicas and confirmed no per-pod override expected

## Step 6: Verification

- [ ] Run apps/api unit tests (at least rate-limit.guard.spec.ts)
- [ ] Run lint/typecheck if available
