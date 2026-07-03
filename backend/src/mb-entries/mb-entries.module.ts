import { Module } from '@nestjs/common';
import { MbEntriesController } from './mb-entries.controller';
import { MbEntriesService } from './mb-entries.service';

@Module({
  controllers: [MbEntriesController],
  providers: [MbEntriesService],
})
export class MbEntriesModule {}
