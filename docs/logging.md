# Centralized Logging Configuration

This document outlines the logging configuration for the backend (`api`) and the `rust-worker` containers, providing instructions on how to inspect, aggregate, and rotate logs.

## 1. Structured Logging Setup

Both the `api` (NestJS) and `rust-worker` (Rust) services output logs directly to `stdout` and `stderr`. To ensure these logs are manageable, structured, and do not consume excessive disk space, we have configured Docker's native `json-file` logging driver.

### 1.1 `docker-compose.yml` Configuration
We utilize a reusable YAML anchor (`x-logging`) to consistently apply the same logging options across our core services:
```yaml
x-logging: &default-logging
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
    compress: "true"
```
- **`max-size: "10m"`**: Log files are rotated when they reach 10 megabytes.
- **`max-file: "3"`**: A maximum of 3 log files are kept (one active, two rotated).
- **`compress: "true"`**: Rotated logs are compressed to save disk space.

## 2. Inspecting Logs in Development

During local development or debugging, you can use standard Docker commands to inspect logs.

### 2.1 View All Logs
To stream logs from all services concurrently:
```bash
docker-compose logs -f
```

### 2.2 View Specific Service Logs
To focus on a single service (e.g., the backend `api` or the `rust-worker`):
```bash
docker-compose logs -f api
docker-compose logs -f rust-worker
```

### 2.3 Filter Logs by Time
You can also view logs from a specific timeframe:
```bash
docker-compose logs --since 1h api
docker-compose logs --tail 100 rust-worker
```

## 3. Aggregation and Production Operations (Optional Guidance)

While the `json-file` driver is sufficient for development, production environments often require aggregating logs into a centralized dashboard for better observability (e.g., ELK stack, Grafana Loki, or Datadog).

### 3.1 Aggregation with Promtail / Loki
If you wish to aggregate these JSON logs into Grafana Loki, you can deploy a Promtail container configured to read from Docker's log directories:
1. Bind-mount the Docker log directory (`/var/lib/docker/containers`) to the Promtail container.
2. Configure Promtail to parse the `json-file` output format.

### 3.2 Using Alternative Docker Logging Drivers
If you use an external logging service (like AWS CloudWatch, Splunk, or Fluentd), you can replace the `driver: "json-file"` in `docker-compose.yml` with the appropriate driver.

Example for Fluentd:
```yaml
x-logging: &default-logging
  driver: "fluentd"
  options:
    fluentd-address: "localhost:24224"
    tag: "remitx.{{.Name}}"
```

This ensures that regardless of the backend logic, container output is consistently routed and formatted for your operational stack.
