import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Sep10Service, InMemoryNonceStore } from './sep10.service';
import { Sep10Controller } from './sep10.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import Redis from 'ioredis';

/**
 * Redis client factory for SEP-10 nonce tracking.
 * Falls back to an in-memory store when REDIS_URL is absent (test environments).
 */
function createSep10Redis(): Redis | InMemoryNonceStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || process.env.NODE_ENV === 'test') {
    return new InMemoryNonceStore() as any;
  }
  const client = new Redis(redisUrl, {
    keyPrefix: '',
    lazyConnect: false,
  });
  client.on('error', (err) => {
    console.error('[SEP10 Redis] connection error:', err.message);
  });
  return client;
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m' },
    }),
    PrismaModule,
    AuditModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    Sep10Service,
    {
      provide: 'SEP10_REDIS',
      useFactory: createSep10Redis,
    },
  ],
  controllers: [AuthController, Sep10Controller],
  exports: [AuthService, JwtAuthGuard, Sep10Service],
})
export class AuthModule {}
