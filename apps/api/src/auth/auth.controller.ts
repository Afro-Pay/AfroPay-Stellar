import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AppThrottlerGuard } from '../common/guards/throttler.guard';
import { IsEmail, IsString, MinLength } from 'class-validator';

class AuthDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  @UseGuards(AppThrottlerGuard)
  @SkipThrottle({ login: true, wallet: true, transaction: true, anchor: true })
  register(@Body() dto: AuthDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  @UseGuards(AppThrottlerGuard)
  @SkipThrottle({ register: true, wallet: true, transaction: true, anchor: true })
  login(@Body() dto: AuthDto) {
    return this.auth.login(dto.email, dto.password);
  }
}
