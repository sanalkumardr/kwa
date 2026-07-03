import { Module } from '@nestjs/common';
import { TendersController } from './tenders.controller';
import { TendersService } from './tenders.service';

@Module({
  controllers: [TendersController],
  providers: [TendersService],
})
export class TendersModule {}
