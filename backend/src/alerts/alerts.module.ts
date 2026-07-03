import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import {
  HttpNotificationSender,
  LogNotificationSender,
  NOTIFICATION_SENDER,
  NotificationSender,
} from '../notifications/notification-sender';

@Module({
  controllers: [AlertsController],
  providers: [
    AlertsService,
    {
      provide: NOTIFICATION_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): NotificationSender => {
        if (config.get<string>('SMS_PROVIDER') === 'http') {
          return new HttpNotificationSender(
            config.getOrThrow<string>('SMS_GATEWAY_URL'),
            config.get<string>('SMS_GATEWAY_API_KEY'),
          );
        }
        return new LogNotificationSender();
      },
    },
  ],
})
export class AlertsModule {}
