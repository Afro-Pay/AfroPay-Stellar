import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function contextFor(role?: string): any {
  return { switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) };
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows admins', () => expect(guard.canActivate(contextFor('ADMIN'))).toBe(true));

  it('rejects non-admin users', () => {
    expect(() => guard.canActivate(contextFor('USER'))).toThrow(ForbiddenException);
  });
});
