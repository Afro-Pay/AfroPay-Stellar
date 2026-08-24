# Stage 1: Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: Production dependencies only (including Prisma Client)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && npx prisma generate

# Stage 3: Runtime stage
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built application and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
# scripts/migrate-*.sh and migrate-classify.js are run as the command for the
# pre-deploy and post-deploy migration Jobs (see deploy/kubernetes). "prisma"
# is a production dependency (not devDependencies) specifically so the CLI
# version used by `npx prisma` here is the one pinned in package.json instead
# of npx silently fetching the latest CLI from the registry at deploy time.
COPY --from=builder /app/scripts ./scripts

EXPOSE 3001
CMD ["node", "dist/main"]

