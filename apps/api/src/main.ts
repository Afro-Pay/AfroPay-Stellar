import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Pino logger
  app.useLogger(app.get(Logger));

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Global correlation ID interceptor
  app.useGlobalInterceptors(new CorrelationIdInterceptor());

  // Global HTTP metrics interceptor — records request count and duration.
  // Must be retrieved from the DI container so PrometheusService is injected.
  app.useGlobalInterceptors(app.get(HttpMetricsInterceptor));

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
  });

  // Global prefix
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  const logger = app.get(Logger);
  logger.info(`🚀 Application running on port ${port}`);
}
bootstrap();
