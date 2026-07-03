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
import { CreateIssueDto, IssuesService } from './issues.service';

@Controller('issues')
@UseGuards(AuthGuard)
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateIssueDto) {
    return this.issues.create(userId, dto);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('status') status?: string,
  ) {
    return this.issues.listByProject(userId, projectId, status);
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: 'open' | 'in_progress' | 'resolved',
  ) {
    return this.issues.setStatus(userId, id, status);
  }
}
