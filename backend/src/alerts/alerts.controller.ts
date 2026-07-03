import { Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AlertsService } from './alerts.service';

@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Manually trigger the at-risk milestone scan for the caller's scope. */
  @Post('milestones')
  async run(@CurrentUser() userId: string): Promise<{ alerted: number }> {
    return { alerted: await this.alerts.runMilestoneChecks(userId) };
  }
}
