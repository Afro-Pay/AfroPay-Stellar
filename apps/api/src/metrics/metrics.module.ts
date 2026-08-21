import { Module, Global } from '@nestjs/common';
import { PrometheusService } from './prometheus.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

/**
 * Global metrics module — importing it once in AppModule makes
 * PrometheusService available for injection anywhere in the application
 * without re-importing the module.
 */
@Global()
@Module({
  providers: [PrometheusService, HttpMetricsInterceptor],
  controllers: [MetricsController],
  exports: [PrometheusService, HttpMetricsInterceptor],
})
export class MetricsModule {}
