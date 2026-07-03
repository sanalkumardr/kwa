import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DprSyncJson, SyncService } from './sync.service';

@Controller('sync')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Push one DPR upsert; returns the authoritative server row. */
  @Post('dpr')
  pushDpr(@CurrentUser() userId: string, @Body() body: DprSyncJson) {
    return this.sync.upsertDpr(userId, body);
  }

  /** Pull DPRs changed since the given ISO timestamp (omit for a full pull). */
  @Get('dpr')
  pullDpr(
    @CurrentUser() userId: string,
    @Query('since') since?: string,
  ) {
    return this.sync.pullDpr(userId, since ?? null);
  }
}
