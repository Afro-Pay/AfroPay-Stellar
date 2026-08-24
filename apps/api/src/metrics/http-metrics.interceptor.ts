import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrometheusService } from './prometheus.service';

/**
 * Records per-request HTTP metrics:
 *   - afropay_http_requests_total{method, route, status_code}
 *   - afropay_http_request_duration_seconds{method, route, status_code}
 *
 * Route normalisation replaces path-param segments (UUIDs, numeric IDs, and
 * Stellar G-addresses) with placeholders so high-cardinality paths do not
 * create unbounded label sets in Prometheus.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly prometheus: PrometheusService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      path: string;
    }>();

    const method = req.method ?? 'UNKNOWN';
    const route = normaliseRoute(req.path ?? '/');
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<{ statusCode: number }>();
          const statusCode = String(res.statusCode ?? 200);
          const durationSeconds = (Date.now() - startTime) / 1000;

          this.prometheus.httpRequestsTotal
            .labels(method, route, statusCode)
            .inc();

          this.prometheus.httpRequestDurationSeconds
            .labels(method, route, statusCode)
            .observe(durationSeconds);
        },
        error: (err: any) => {
          const statusCode = String(err?.status ?? err?.statusCode ?? 500);
          const durationSeconds = (Date.now() - startTime) / 1000;

          this.prometheus.httpRequestsTotal
            .labels(method, route, statusCode)
            .inc();

          this.prometheus.httpRequestDurationSeconds
            .labels(method, route, statusCode)
            .observe(durationSeconds);
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a raw request path into a stable route label.
 *
 * Replaces:
 *   - UUID v4 segments        → :id
 *   - Pure numeric segments   → :id
 *   - Stellar public keys (G…)→ :account
 *
 * Examples:
 *   /api/wallet/GABC123…/balance  → /api/wallet/:account/balance
 *   /api/transactions/123e4567-… → /api/transactions/:id
 *   /api/transactions/42          → /api/transactions/:id
 */
function normaliseRoute(path: string): string {
  return path
    .replace(
      /\/G[A-Z0-9]{54,}/g,
      '/:account',
    )
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '/:id',
    )
    .replace(/\/\d+/g, '/:id');
}
