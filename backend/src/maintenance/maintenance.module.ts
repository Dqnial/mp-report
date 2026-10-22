import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { redisEnabled } from '../redis/redis.config';
import {
  MAINTENANCE_QUEUE,
  MaintenanceProcessor,
} from './maintenance.processor';
import { MaintenanceService } from './maintenance.service';

const withQueue = redisEnabled();

@Module({
  imports: withQueue
    ? [BullModule.registerQueue({ name: MAINTENANCE_QUEUE })]
    : [],
  providers: [MaintenanceService, ...(withQueue ? [MaintenanceProcessor] : [])],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
