import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { IsEmail, IsString, MinLength } from 'class-validator';

class AuthDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

class RefreshSessionDto {
  @IsString() refresh_token: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: AuthDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  login(@Body() dto: AuthDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshSessionDto) {
    return this.auth.refreshSession(dto.refresh_token);
  }
}
