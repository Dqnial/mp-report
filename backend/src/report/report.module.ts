import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/templates.module';
import { VisitsModule } from '../visits/visits.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [TemplatesModule, VisitsModule],
  controllers: [ReportController, PlanController],
  providers: [ReportService, PlanService],
})
export class ReportModule {}
