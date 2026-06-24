import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableCors();
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap().catch((err) => {
  console.error('[AfroPay] FATAL: Application failed to start');
  console.error(err.message ?? err);
  process.exit(1);
});
