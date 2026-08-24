import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditLogService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { Logger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

function makeMocks() {
  const users: any[] = [];
  const mockPrisma = {
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.email === where.email || u.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }: any) => {
        const user = {
          id: `user-${users.length + 1}`,
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        users.push(user);
        return Promise.resolve(user);
      }),
    },
  };

  const mockJwtService = {
    sign: jest.fn(() => 'signed-token'),
  };

  const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
  const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return { prisma: mockPrisma, jwt: mockJwtService, audit: mockAudit, logger: mockLogger, users };
}

async function compileService(mocks: ReturnType<typeof makeMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaClient, useValue: mocks.prisma },
      { provide: JwtService, useValue: mocks.jwt },
      { provide: AuditLogService, useValue: mocks.audit },
      { provide: Logger, useValue: mocks.logger },
    ],
  }).compile();
  return module.get<AuthService>(AuthService);
}

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('hashes the password, creates the user, and returns access_token + user', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password_123');

      const result = await service.register({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        name: 'New User',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('SecurePassword123!', 10);
      expect(mocks.prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'newuser@example.com',
          password: 'hashed_password_123',
          name: 'New User',
        },
      });
      expect(mocks.jwt.sign).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          access_token: 'signed-token',
          user: expect.objectContaining({ email: 'newuser@example.com' }),
        }),
      );
    });

    it('throws ConflictException for a duplicate email and creates nothing', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);
      mocks.users.push({
        id: 'user-existing',
        email: 'existing@example.com',
        password: 'x',
        name: 'Existing User',
      });

      await expect(
        service.register({ email: 'existing@example.com', password: 'SecurePassword123!' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    });

    it('writes a REGISTER audit event', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hash');

      await service.register({ email: 'a@b.com', password: 'password123' });

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'AUTH',
          operation: 'REGISTER',
          outcome: 'SUCCESS',
        }),
      );
    });
  });

  describe('login', () => {
    it('returns access_token + user for valid credentials', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);
      mocks.users.push({
        id: 'user-1',
        email: 'user@example.com',
        password: 'hashed_correct_password',
        name: 'Test User',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'user@example.com',
        password: 'CorrectPassword123!',
      });

      expect(bcrypt.compare).toHaveBeenCalledWith(
        'CorrectPassword123!',
        'hashed_correct_password',
      );
      expect(result).toEqual(
        expect.objectContaining({
          access_token: 'signed-token',
          user: expect.objectContaining({ id: 'user-1', email: 'user@example.com' }),
        }),
      );
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'SomePassword123!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException on a wrong password', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);
      mocks.users.push({
        id: 'user-1',
        email: 'user@example.com',
        password: 'hashed_correct_password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'user@example.com', password: 'WrongPassword123!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('writes a LOGIN audit event on success', async () => {
      const mocks = makeMocks();
      const service = await compileService(mocks);
      mocks.users.push({
        id: 'user-1',
        email: 'user@example.com',
        password: 'hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login({ email: 'user@example.com', password: 'pw' });

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'AUTH', operation: 'LOGIN' }),
      );
    });
  });
});
