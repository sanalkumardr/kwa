import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateMilestoneDto,
  MilestonesService,
} from './milestones.service';

@Controller('milestones')
@UseGuards(AuthGuard)
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateMilestoneDto) {
    return this.milestones.create(userId, dto);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.milestones.listByProject(userId, projectId);
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
  ) {
    return this.milestones.setStatus(userId, id, status);
  }
}
