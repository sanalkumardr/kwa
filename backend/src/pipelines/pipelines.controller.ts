import {
  Body,
  Controller,
  Get,
  ParseFloatPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateSegmentDto, PipelinesService } from './pipelines.service';

@Controller('pipelines')
@UseGuards(AuthGuard)
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Post('segments')
  createSegment(@CurrentUser() userId: string, @Body() dto: CreateSegmentDto) {
    return this.pipelines.createSegment(userId, dto);
  }

  @Get('segments')
  listSegments(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.pipelines.listSegments(userId, projectId);
  }

  /** GET /pipelines/locate?projectId=&lng=&lat= → nearest chainage */
  @Get('locate')
  locate(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('lng', ParseFloatPipe) lng: number,
    @Query('lat', ParseFloatPipe) lat: number,
  ) {
    return this.pipelines.locate(userId, projectId, lng, lat);
  }

  @Get('progress')
  progress(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.pipelines.progress(userId, projectId);
  }
}
