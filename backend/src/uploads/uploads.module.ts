import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { LocalDiskStorage, S3Storage, STORAGE, Storage } from './storage';

@Module({
  controllers: [UploadsController],
  providers: [
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Storage => {
        if (config.get<string>('STORAGE_PROVIDER') === 's3') {
          return new S3Storage(config.getOrThrow<string>('S3_BUCKET'), {
            region: config.get<string>('S3_REGION') ?? 'ap-south-1',
            endpoint: config.get<string>('S3_ENDPOINT'),
            forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
            accessKeyId: config.get<string>('S3_ACCESS_KEY_ID'),
            secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY'),
          });
        }
        return new LocalDiskStorage(config.get<string>('UPLOAD_DIR') ?? './uploads');
      },
    },
  ],
})
export class UploadsModule {}
