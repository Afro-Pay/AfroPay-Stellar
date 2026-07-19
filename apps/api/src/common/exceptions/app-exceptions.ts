import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Thrown when client input fails validation.
 * Maps to HTTP 400.
 */
export class ValidationException extends BadRequestException {
  constructor(
    message: string,
    public readonly details?: string | string[] | Record<string, unknown>,
  ) {
    super({ code: 'VALIDATION_ERROR', message, details });
  }
}

/**
 * Thrown when a user is not authenticated or credentials are invalid.
 * Maps to HTTP 401.
 */
export class AuthenticationException extends UnauthorizedException {
  constructor(
    message = 'Authentication required',
    public readonly code = 'AUTHENTICATION_REQUIRED',
  ) {
    super({ code, message });
  }
}

/**
 * Thrown when an authenticated user lacks permission for an action.
 * Maps to HTTP 403.
 */
export class AuthorizationException extends ForbiddenException {
  constructor(message = 'You do not have permission to perform this action') {
    super({ code: 'AUTHORIZATION_DENIED', message });
  }
}

/**
 * Thrown when a requested resource does not exist.
 * Maps to HTTP 404.
 */
export class ResourceNotFoundException extends NotFoundException {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' was not found`
      : `${resource} was not found`;
    super({ code: 'RESOURCE_NOT_FOUND', message, resource });
  }
}

/**
 * Thrown when a conflict prevents the operation (e.g. duplicate registration).
 * Maps to HTTP 409.
 */
export class ConflictException extends HttpException {
  constructor(message: string, details?: string) {
    super({ code: 'CONFLICT', message, details }, HttpStatus.CONFLICT);
  }
}

/**
 * Thrown for unexpected runtime errors that are not the client's fault.
 * Maps to HTTP 500.
 */
export class InternalException extends InternalServerErrorException {
  constructor(message = 'An unexpected error occurred. Please try again later.') {
    super({ code: 'INTERNAL_ERROR', message });
  }
}
