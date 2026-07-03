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
import { CreateDprDto, DprService } from './dpr.service';

@Controller('dpr')
@UseGuards(AuthGuard)
export class DprController {
  constructor(private readonly dpr: DprService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateDprDto) {
    return this.dpr.create(userId, dto);
  }

  @Post(':id/submit')
  submit(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dpr.submit(userId, id);
  }

  @Post(':id/approve')
  approve(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dpr.approve(userId, id);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.dpr.listByProject(userId, projectId);
  }
}
