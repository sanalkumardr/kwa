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
import { CreateQualityTestDto, QualityService } from './quality.service';

@Controller('quality-tests')
@UseGuards(AuthGuard)
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateQualityTestDto) {
    return this.quality.create(userId, dto);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.quality.listByProject(userId, projectId);
  }
}
