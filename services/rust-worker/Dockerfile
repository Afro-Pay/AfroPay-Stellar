# Stage 1: Build stage with dependency caching
FROM rust:1.77-slim AS builder
WORKDIR /app

# Create a dummy src/main.rs to build and cache cargo dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
COPY Cargo.toml Cargo.lock ./

# Use cache mounts for cargo registry and git dependencies
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release

# Remove the dummy worker binary/build artifacts
RUN rm -f src/main.rs target/release/deps/worker*

# Copy the real source files
COPY src ./src

# Build the real worker binary using cache mount
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && \
    cp target/release/worker /app/worker

# Stage 2: Runtime stage
FROM debian:bookworm-slim AS runtime
WORKDIR /app

# Install runtime dependencies if needed (e.g. openssl, ca-certificates)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/worker ./worker

CMD ["./worker"]

