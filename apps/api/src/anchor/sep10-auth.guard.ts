import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AnchorService } from './anchor.service';

@Injectable()
export class Sep10AuthGuard implements CanActivate {
  constructor(private readonly anchorService: AnchorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const payload = await this.anchorService.verifySep10Token(token);
      request.sep10User = { account: payload.sub }; // Attach user info to request
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid SEP-10 token');
    }
  }
}
