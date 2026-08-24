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

  validate(payload: JwtPayload) {
    // Reject refresh tokens submitted as access tokens.
    if (payload.type === 'refresh') {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Access token is invalid or missing.',
      });
    }

    // Both email/password and SEP-10 sessions share the same guard;
    // downstream services receive whichever identity fields are present.
    return {
      userId: payload.sub,
      email: payload.email ?? null,
      stellarPublicKey: payload.stellarPublicKey ?? null,
      authType: payload.type === 'sep10' ? 'sep10' : 'password',
    };
  }
}
