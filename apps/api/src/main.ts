import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Centralised error handling ──────────────────────────────────────────────
  // GlobalExceptionFilter must be registered first so it wraps all errors,
  // including those thrown by the ValidationPipe below.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global ValidationPipe — transforms & validates all incoming DTOs.
  // Errors are caught by GlobalExceptionFilter and formatted consistently.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // strip properties not in the DTO
      forbidNonWhitelisted: true, // error on unknown properties
      transform: true,          // auto-transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger configuration (only in development)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AfroPay-Stellar API')
      .setDescription('API documentation for AfroPay-Stellar')
      .setVersion('1.0')
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
      .addTag('auth', 'Authentication endpoints')
      .addTag('wallet', 'Wallet management endpoints')
      .addTag('transaction', 'Transaction management endpoints')
      .addTag('anchor', 'Anchor endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });

    console.log('📚 Swagger documentation available at /api/docs');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}
bootstrap();
