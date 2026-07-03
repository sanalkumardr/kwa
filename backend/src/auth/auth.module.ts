import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  HttpOtpSender,
  LogOtpSender,
  OTP_SENDER,
  OtpSender,
} from './otp-sender';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: OTP_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OtpSender => {
        if (config.get<string>('SMS_PROVIDER') === 'http') {
          return new HttpOtpSender(
            config.getOrThrow<string>('SMS_GATEWAY_URL'),
            config.get<string>('SMS_GATEWAY_API_KEY'),
            config.get<string>('SMS_MESSAGE_TEMPLATE'),
          );
        }
        return new LogOtpSender();
      },
    },
  ],
})
export class AuthModule {}
