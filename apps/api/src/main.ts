import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { writeFileSync } from 'fs';
import { join } from 'path';

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

  // Swagger/OpenAPI configuration
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('AfroPay-Stellar API')
      .setDescription(
        'Cross-border remittance platform API built on Stellar blockchain. ' +
        'Supports secure wallet management, Stellar payments, KYC verification, ' +
        'and anchor integrations for fiat on/off ramps.'
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addServer('http://localhost:3000', 'Local Development')
      .addServer('https://api-staging.afropay.io', 'Staging')
      .addTag('auth', 'Authentication and user registration')
      .addTag('wallet', 'Stellar wallet management')
      .addTag('transaction', 'Payment transactions and history')
      .addTag('kyc', 'Know Your Customer verification')
      .addTag('anchor', 'Stellar anchor integrations (SEP-6, SEP-24)')
      .addTag('audit', 'Audit logs and compliance')
      .addTag('admin', 'Administrative operations')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    
    // Serve Swagger UI at /api/docs
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'AfroPay API Docs',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
      },
    });

    // Export OpenAPI spec to docs/openapi.json
    const outputPath = join(process.cwd(), 'docs', 'openapi.json');
    writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf8');
    
    const logger = app.get(Logger);
    logger.info(`📚 API documentation available at http://localhost:${process.env.PORT || 3000}/api/docs`);
    logger.info(`📄 OpenAPI spec exported to ${outputPath}`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  const logger = app.get(Logger);
  logger.log(`🚀 Application running on port ${port}`);
}
bootstrap();
