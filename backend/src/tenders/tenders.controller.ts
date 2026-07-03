import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateTenderDto, TendersService } from './tenders.service';

@Controller('tenders')
@UseGuards(AuthGuard)
export class TendersController {
  constructor(private readonly tenders: TendersService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateTenderDto) {
    return this.tenders.create(userId, dto);
  }

  @Get()
  getByProject(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.tenders.getByProject(userId, projectId);
  }
}
