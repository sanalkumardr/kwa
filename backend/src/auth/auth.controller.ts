import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

interface RequestOtpDto {
  phone: string;
}
interface VerifyOtpDto {
  phone: string;
  code: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Public: obtain a token. */
  @Post('request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  /** Authenticated: who am I (for role-gating the client UI). */
  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }
}
