import { ArgumentsHost, BadRequestException, HttpException, HttpStatus, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GlobalExceptionFilter, ErrorResponse } from './global-exception.filter';

// ---------------------------------------------------------------------------
// Helpers to build a mock ArgumentsHost
// ---------------------------------------------------------------------------

function buildMockHost(method = 'GET', url = '/test'): ArgumentsHost {
  const mockJson = jest.fn();
  const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
  const mockResponse = { status: mockStatus };
  const mockRequest = { method, url };

  return {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;
}

function captureResponse(host: ArgumentsHost): {
  statusCode: number;
  body: ErrorResponse;
} {
  const res = host.switchToHttp().getResponse<any>();
  const statusCode: number = res.status.mock.calls[0][0];
  const body: ErrorResponse = res.status().json.mock.calls[0][0];
  return { statusCode, body };
}

// ---------------------------------------------------------------------------

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    // Suppress logger noise during tests
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((filter as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. NestJS built-in HttpExceptions ─────────────────────────────────────

  describe('HttpException handling', () => {
    it('returns 400 with BAD_REQUEST code for BadRequestException (string response)', () => {
      const host = buildMockHost();
      filter.catch(new BadRequestException('Bad input'), host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(400);
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.message).toBe('Bad input');
      expect(body.path).toBe('/test');
      expect(body.timestamp).toBeDefined();
    });

    it('returns 401 with UNAUTHORIZED code for UnauthorizedException', () => {
      const host = buildMockHost();
      filter.catch(new UnauthorizedException('Unauthorized'), host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 with NOT_FOUND code for NotFoundException', () => {
      const host = buildMockHost();
      filter.catch(new NotFoundException('Resource not found'), host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toBe('Resource not found');
    });
  });

  // ── 2. Custom structured HttpExceptions (object response payload) ──────────

  describe('structured HttpException payloads', () => {
    it('extracts code and message from object response payload', () => {
      const host = buildMockHost();
      const exc = new UnauthorizedException({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Access token expired.',
        expiredAt: '2024-01-01T00:00:00Z',
      });

      filter.catch(exc, host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(401);
      expect(body.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(body.message).toBe('Access token expired.');
    });

    it('falls back to codeFromStatus when payload has no code field', () => {
      const host = buildMockHost();
      const exc = new BadRequestException({ message: 'Something wrong' });

      filter.catch(exc, host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(400);
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.message).toBe('Something wrong');
    });

    it('includes details field when present in the payload', () => {
      const host = buildMockHost();
      const exc = new HttpException(
        { code: 'CONFLICT', message: 'Email already registered', details: 'user@example.com' },
        HttpStatus.CONFLICT,
      );

      filter.catch(exc, host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(409);
      expect(body.code).toBe('CONFLICT');
      expect(body.details).toBe('user@example.com');
    });
  });

  // ── 3. ValidationPipe string-array messages ───────────────────────────────

  describe('ValidationPipe error handling', () => {
    it('joins string[] message array with semicolons', () => {
      const host = buildMockHost('POST', '/auth/register');
      const exc = new BadRequestException({
        message: ['email must be an email', 'password must be longer than 8 characters'],
        error: 'Bad Request',
        statusCode: 400,
      });

      filter.catch(exc, host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(400);
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.message).toContain('email must be an email');
      expect(body.message).toContain('password must be longer than 8 characters');
    });

    it('sets details when there are multiple validation messages', () => {
      const host = buildMockHost();
      const exc = new BadRequestException({
        message: ['field1 error', 'field2 error'],
      });

      filter.catch(exc, host);
      const { statusCode, body } = captureResponse(host);

      expect(Array.isArray(body.details)).toBe(true);
      expect((body.details as string[]).length).toBe(2);
    });

    it('omits details when there is only a single validation message', () => {
      const host = buildMockHost();
      const exc = new BadRequestException({
        message: ['only one error'],
      });

      filter.catch(exc, host);
      const { body } = captureResponse(host);

      expect(body.details).toBeUndefined();
    });
  });

  // ── 4. Unknown / runtime errors ───────────────────────────────────────────

  describe('unknown / runtime error handling', () => {
    it('returns 500 for a plain Error without leaking the message', () => {
      const host = buildMockHost();
      filter.catch(new Error('Database connection failed — secret DSN exposed'), host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
      // The raw error message must not be forwarded to the client
      expect(body.message).not.toContain('Database connection failed');
      expect(body.message).toBe('An unexpected error occurred. Please try again later.');
    });

    it('returns 500 for a thrown non-Error value (e.g. string)', () => {
      const host = buildMockHost();
      filter.catch('some unexpected string throw', host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 for a null exception', () => {
      const host = buildMockHost();
      filter.catch(null, host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── 5. Response envelope shape ─────────────────────────────────────────────

  describe('response envelope', () => {
    it('always includes statusCode, code, message, timestamp, path', () => {
      const host = buildMockHost('POST', '/wallet');
      filter.catch(new BadRequestException('Test'), host);
      const { body } = captureResponse(host);

      expect(body).toHaveProperty('statusCode');
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path', '/wallet');
    });

    it('timestamp is a valid ISO 8601 string', () => {
      const host = buildMockHost();
      filter.catch(new BadRequestException('Test'), host);
      const { body } = captureResponse(host);

      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('does not include a details key when there are no details', () => {
      const host = buildMockHost();
      filter.catch(new NotFoundException('Not found'), host);
      const { body } = captureResponse(host);

      expect(Object.prototype.hasOwnProperty.call(body, 'details')).toBe(false);
    });
  });

  // ── 6. Rate limit / HTTP 429 ──────────────────────────────────────────────

  describe('rate limit error', () => {
    it('returns 429 with TOO_MANY_REQUESTS code', () => {
      const host = buildMockHost();
      const exc = new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);

      filter.catch(exc, host);
      const { statusCode, body } = captureResponse(host);

      expect(statusCode).toBe(429);
      expect(body.code).toBe('TOO_MANY_REQUESTS');
      expect(body.message).toBe('Rate limit exceeded');
    });
  });
});
