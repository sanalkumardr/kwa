import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { AuthGuard } from '../auth/auth.guard';
import { Storage, STORAGE } from './storage';

interface UploadBody {
  entity: string;
  entityId: string;
}

/**
 * Receives a photo and stores it via the configured Storage (local disk or S3),
 * returning a stable object key the client writes onto the owning row, plus a
 * download URL for immediate display.
 */
@Controller('uploads')
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(@Inject(STORAGE) private readonly storage: Storage) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadBody,
  ): Promise<{ key: string; url: string }> {
    if (!file) throw new BadRequestException('file is required');
    if (!body.entity || !body.entityId) {
      throw new BadRequestException('entity and entityId are required');
    }

    const safeName = (file.originalname || 'photo').replace(/[^\w.\-]/g, '_');
    const key = `${body.entity}/${body.entityId}/${randomUUID()}_${safeName}`;

    await this.storage.put(key, file.buffer, file.mimetype);
    const url = await this.storage.getDownloadUrl(key);
    return { key, url };
  }
}
