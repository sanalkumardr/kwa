import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BillsService } from './bills.service';

interface CreateBillDto {
  projectId: string;
  referenceDate: string; // YYYY-MM-DD
}

@Controller('bills')
@UseGuards(AuthGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.bills.listByProject(userId, projectId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateBillDto) {
    return this.bills.createDraft(userId, dto.projectId, dto.referenceDate);
  }

  @Post(':id/compute')
  compute(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bills.compute(userId, id);
  }

  @Post(':id/certify')
  certify(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bills.certify(userId, id);
  }

  @Get(':id/deductions')
  deductions(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bills.deductions(userId, id);
  }
}
