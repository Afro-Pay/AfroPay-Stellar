import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

class AuthDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: AuthDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  @RateLimit({
    keyPrefix: 'auth:login',
    limit: 5,
    windowMs: 60_000,
    limitEnv: 'LOGIN_RATE_LIMIT_MAX',
    windowMsEnv: 'LOGIN_RATE_LIMIT_WINDOW_MS',
  })
  login(@Body() dto: AuthDto) {
    return this.auth.login(dto.email, dto.password);
  }
}
