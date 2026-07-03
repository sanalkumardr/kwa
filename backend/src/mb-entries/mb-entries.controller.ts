import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateMbEntryDto, MbEntriesService } from './mb-entries.service';

@Controller('mb-entries')
@UseGuards(AuthGuard)
export class MbEntriesController {
  constructor(private readonly mb: MbEntriesService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateMbEntryDto) {
    return this.mb.create(userId, dto);
  }

  @Post(':id/check')
  check(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.mb.check(userId, id);
  }

  @Post(':id/approve')
  approve(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.mb.approve(userId, id);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('milestoneId', ParseUUIDPipe) milestoneId: string,
  ) {
    return this.mb.listByMilestone(userId, milestoneId);
  }
}
