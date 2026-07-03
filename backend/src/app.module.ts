import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { BillsModule } from './bills/bills.module';
import { ProjectsModule } from './projects/projects.module';
import { MilestonesModule } from './milestones/milestones.module';
import { DprModule } from './dpr/dpr.module';
import { TendersModule } from './tenders/tenders.module';
import { PaymentsModule } from './payments/payments.module';
import { MbEntriesModule } from './mb-entries/mb-entries.module';
import { SyncModule } from './sync/sync.module';
import { UploadsModule } from './uploads/uploads.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { QualityModule } from './quality/quality.module';
import { IssuesModule } from './issues/issues.module';
import { DocumentsModule } from './documents/documents.module';
import { ReportsModule } from './reports/reports.module';
import { AlertsModule } from './alerts/alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    TendersModule,
    MilestonesModule,
    MbEntriesModule,
    PipelinesModule,
    QualityModule,
    IssuesModule,
    DocumentsModule,
    ReportsModule,
    AlertsModule,
    DprModule,
    BillsModule,
    PaymentsModule,
    SyncModule,
    UploadsModule,
  ],
})
export class AppModule {}
