import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('register', () => {
    it('should successfully register a new user with a new email', async () => {
      const registerDto = {
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        name: 'New User',
      };

      const hashedPassword = 'hashed_password_123';
      const createdUser = {
        id: 'user-1',
        email: registerDto.email,
        name: registerDto.name,
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(createdUser);
      mockJwtService.sign.mockReturnValue('access_token_123');

      const result = await service.register(registerDto);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: registerDto.email,
          name: registerDto.name,
          passwordHash: hashedPassword,
        },
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: createdUser.id,
        email: createdUser.email,
      });
      expect(result).toEqual({
        user: createdUser,
        accessToken: 'access_token_123',
      });
    });

    it('should throw ConflictException when registering with duplicate email', async () => {
      const registerDto = {
        email: 'existing@example.com',
        password: 'SecurePassword123!',
        name: 'New User',
      };

      const existingUser = {
        id: 'user-existing',
        email: registerDto.email,
        name: 'Existing User',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(existingUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
    });

    it('should hash password with bcrypt', async () => {
      const registerDto = {
        email: 'user@example.com',
        password: 'MyPassword123!',
        name: 'Test User',
      };

      const hashedPassword = 'hashed_result';
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-1',
        ...registerDto,
        passwordHash: hashedPassword,
      });
      mockJwtService.sign.mockReturnValue('token');

      await service.register(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
    });
  });

  describe('login', () => {
    it('should successfully login with correct email and password', async () => {
      const loginDto = {
        email: 'user@example.com',
        password: 'CorrectPassword123!',
      };

      const dbUser = {
        id: 'user-1',
        email: loginDto.email,
        name: 'Test User',
        passwordHash: 'hashed_correct_password',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(dbUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('access_token_123');

      const result = await service.login(loginDto);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: loginDto.email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        dbUser.passwordHash,
      );
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: dbUser.id,
        email: dbUser.email,
      });
      expect(result).toEqual({
        user: dbUser,
        accessToken: 'access_token_123',
      });
    });

    it('should throw UnauthorizedException when user not found', async () => {
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'SomePassword123!',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException with wrong password', async () => {
      const loginDto = {
        email: 'user@example.com',
        password: 'WrongPassword123!',
      };

      const dbUser = {
        id: 'user-1',
        email: loginDto.email,
        name: 'Test User',
        passwordHash: 'hashed_correct_password',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(dbUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        dbUser.passwordHash,
      );
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password comparison fails', async () => {
      const loginDto = {
        email: 'user@example.com',
        password: 'Password123!',
      };

      const dbUser = {
        id: 'user-1',
        email: loginDto.email,
        passwordHash: 'hashed_password',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(dbUser);
      (bcrypt.compare as jest.Mock).mockRejectedValue(
        new Error('Bcrypt error'),
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('validateToken', () => {
    it('should validate a valid JWT token', async () => {
      const token = 'valid_jwt_token';
      const decoded = {
        sub: 'user-1',
        email: 'user@example.com',
        iat: Math.floor(Date.now() / 1000),
      };

      mockJwtService.verify.mockReturnValue(decoded);

      const result = service.validateToken(token);

      expect(mockJwtService.verify).toHaveBeenCalledWith(token);
      expect(result).toEqual(decoded);
    });

    it('should throw error for invalid token', () => {
      const token = 'invalid_token';
      const error = new Error('Invalid token');

      mockJwtService.verify.mockImplementation(() => {
        throw error;
      });

      expect(() => service.validateToken(token)).toThrow(error);
    });
  });

  describe('refreshToken', () => {
    it('should generate a new access token from valid token', async () => {
      const oldToken = 'old_token';
      const decoded = {
        sub: 'user-1',
        email: 'user@example.com',
      };

      const dbUser = {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      };

      mockJwtService.verify.mockReturnValue(decoded);
      mockPrismaService.user.findUnique.mockResolvedValue(dbUser);
      mockJwtService.sign.mockReturnValue('new_access_token');

      const result = await service.refreshToken(oldToken);

      expect(mockJwtService.verify).toHaveBeenCalledWith(oldToken);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: decoded.sub },
      });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: dbUser.id,
        email: dbUser.email,
      });
      expect(result).toEqual({ accessToken: 'new_access_token' });
    });

    it('should throw error if token is invalid', async () => {
      const oldToken = 'invalid_token';

      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken(oldToken)).rejects.toThrow(
        'Invalid token',
      );
    });

    it('should throw error if user not found', async () => {
      const oldToken = 'valid_token';
      const decoded = {
        sub: 'nonexistent-user',
        email: 'nonexistent@example.com',
      };

      mockJwtService.verify.mockReturnValue(decoded);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(oldToken)).rejects.toThrow();
    });
  });
});