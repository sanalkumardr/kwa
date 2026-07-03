import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreatePaymentDto, PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  sanction(@CurrentUser() userId: string, @Body() dto: CreatePaymentDto) {
    return this.payments.sanction(userId, dto);
  }

  @Get('by-bill/:billId')
  listByBill(
    @CurrentUser() userId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
  ) {
    return this.payments.listByBill(userId, billId);
  }
}
