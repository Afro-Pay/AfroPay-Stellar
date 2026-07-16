import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ValidationError } from 'class-validator';

/**
 * Stable JSON error envelope returned by all API error responses.
 */
export interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

/**
 * GlobalExceptionFilter catches every thrown error and normalises it into
 * a predictable ErrorResponse shape before sending the HTTP response.
 *
 * Rules:
 *  - HttpException (NestJS built-ins and our custom exceptions) → use the
 *    status code and payload from the exception.
 *  - class-validator ValidationError arrays (forwarded by the ValidationPipe)
 *    → flatten field-level error messages and return 400.
 *  - Everything else (unhandled runtime errors) → 500, no internal details
 *    leaked to the client.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, code, message, details } = this.resolveError(exception);

    // Log internal errors with full stack; log client errors at warn level.
    if (statusCode >= 500) {
      this.logger.error(
        `[${statusCode}] ${request.method} ${request.url} — ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${statusCode}] ${request.method} ${request.url} — ${message}`);
    }

    const body: ErrorResponse = {
      statusCode,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveError(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    // ── NestJS / custom HttpException ─────────────────────────────────────────
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();

      if (typeof raw === 'string') {
        return {
          statusCode,
          code: this.codeFromStatus(statusCode),
          message: raw,
        };
      }

      if (typeof raw === 'object' && raw !== null) {
        const payload = raw as Record<string, unknown>;

        // class-validator ValidationPipe forwards { message: string[] } when
        // stopAtFirstError is false (default).
        if (Array.isArray(payload['message'])) {
          const messages = payload['message'] as string[];

          // Detect if the array contains class-validator ValidationError objects.
          const isValidationErrors = messages.length > 0 && typeof messages[0] === 'object';

          if (isValidationErrors) {
            const details = this.flattenValidationErrors(
              messages as unknown as ValidationError[],
            );
            return {
              statusCode,
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              details,
            };
          }

          return {
            statusCode,
            code: (payload['code'] as string) ?? this.codeFromStatus(statusCode),
            message: messages.join('; '),
            details: messages.length > 1 ? messages : undefined,
          };
        }

        return {
          statusCode,
          code: (payload['code'] as string) ?? this.codeFromStatus(statusCode),
          message: (payload['message'] as string) ?? exception.message,
          details: payload['details'] as unknown,
        };
      }

      return {
        statusCode,
        code: this.codeFromStatus(statusCode),
        message: exception.message,
      };
    }

    // ── Unknown / unhandled runtime errors ────────────────────────────────────
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      // Never leak raw error messages from unexpected exceptions.
      message: 'An unexpected error occurred. Please try again later.',
    };
  }

  /**
   * Recursively flatten class-validator ValidationError trees into a plain
   * record of { field: string[] } error messages — safe to expose to clients.
   */
  private flattenValidationErrors(
    errors: ValidationError[],
    parentField = '',
  ): Record<string, string[]> {
    return errors.reduce<Record<string, string[]>>((acc, error) => {
      const field = parentField ? `${parentField}.${error.property}` : error.property;

      if (error.constraints) {
        acc[field] = Object.values(error.constraints);
      }

      if (error.children && error.children.length > 0) {
        Object.assign(acc, this.flattenValidationErrors(error.children, field));
      }

      return acc;
    }, {});
  }

  /** Maps a numeric HTTP status to a stable machine-readable code string. */
  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'HTTP_ERROR';
  }
}
