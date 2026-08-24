import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/** Shape of the JWT payload produced by both AuthService (email/password)
 *  and Sep10Service (SEP-10 cryptographic auth). */
interface JwtPayload {
  sub: string;
  email?: string;
  stellarPublicKey?: string;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  validate(payload: { sub: string; email: string; role?: string; type?: string }) {
    if (payload.type === 'refresh') {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Access token is invalid or missing.',
      });
    }

    return { userId: payload.sub, email: payload.email, role: payload.role ?? 'USER' };
  }
}
