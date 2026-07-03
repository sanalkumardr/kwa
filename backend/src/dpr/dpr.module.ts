import { Module } from '@nestjs/common';
import { DprController } from './dpr.controller';
import { DprService } from './dpr.service';

@Module({
  controllers: [DprController],
  providers: [DprService],
})
export class DprModule {}
