import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateDocumentDto, DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateDocumentDto) {
    return this.documents.create(userId, dto);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.documents.listByProject(userId, projectId);
  }

  @Get('expiring')
  expiring(
    @CurrentUser() userId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('withinDays', new ParseIntPipe({ optional: true })) withinDays?: number,
  ) {
    return this.documents.expiring(userId, projectId, withinDays ?? 30);
  }
}
