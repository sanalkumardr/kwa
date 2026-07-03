import {
  Controller,
  Get,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Division rollup; optional `orgUnitId` narrows to that node's subtree. */
  @Get('rollup')
  rollup(
    @CurrentUser() userId: string,
    @Query('orgUnitId') orgUnitId?: string,
  ) {
    return this.reports.rollup(userId, orgUnitId);
  }

  /** Full audit chain for a project (AG/CAG export). */
  @Get('audit-export')
  auditExport(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.reports.auditExport(userId, projectId);
  }
}
