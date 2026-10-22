import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { redisEnabled } from '../redis/redis.config';
import { TemplateImportProcessor } from './template-import.processor';
import { TemplatesController } from './templates.controller';
import { TEMPLATE_QUEUE, TemplatesService } from './templates.service';

// очередь и воркер — только когда есть Redis; без него импорт идёт в запросе
const withQueue = redisEnabled();

@Module({
  imports: [
    DirectoryModule,
    ...(withQueue ? [BullModule.registerQueue({ name: TEMPLATE_QUEUE })] : []),
  ],
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    ...(withQueue ? [TemplateImportProcessor] : []),
  ],
  exports: [TemplatesService],
})
export class TemplatesModule {}
