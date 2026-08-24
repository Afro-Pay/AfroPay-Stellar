import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrometheusService } from './prometheus.service';

/**
 * Exposes GET /metrics for Prometheus scraping.
 *
 * The endpoint sits outside the global `api` prefix — it is registered
 * directly on `/metrics` so it matches the Prometheus scrape_config path
 * without any extra path stripping configuration.
 *
 * Authentication is intentionally omitted here: the endpoint is intended to
 * be network-isolated (accessible only from the Prometheus container via the
 * internal Docker network, not publicly exposed).
 */
@Controller()
export class MetricsController {
  constructor(private readonly prometheus: PrometheusService) {}

  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    const [metrics, contentType] = await Promise.all([
      this.prometheus.getMetrics(),
      Promise.resolve(this.prometheus.getContentType()),
    ]);

    res.setHeader('Content-Type', contentType);
    res.end(metrics);
  }
}
