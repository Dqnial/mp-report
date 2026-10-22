import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { quietRedisErrors } from '../redis/quiet-errors';
import {
  TEMPLATE_QUEUE,
  TemplatesService,
  type ImportCounts,
  type ImportJobData,
} from './templates.service';

/**
 * Воркер очереди импорта: строки загруженного шаблона → визиты «из файла».
 * Один импорт за раз — импорты одного пользователя не мешают друг другу.
 */
@Processor(TEMPLATE_QUEUE, { concurrency: 1 })
export class TemplateImportProcessor extends WorkerHost {
  private readonly logger = new Logger('TemplateImport');

  private readonly onRedisError = quietRedisErrors(
    this.logger,
    'воркер импорта',
  );

  constructor(private readonly templates: TemplatesService) {
    super();
  }

  @OnWorkerEvent('error')
  onError(e: Error) {
    this.onRedisError(e);
  }

  async process(job: Job<ImportJobData, ImportCounts>) {
    const { userId, month } = job.data;
    const counts = await this.templates.importStored(userId, month);
    this.logger.log(
      `импорт ${month}: новых ${counts.created}, привязано ${counts.linked} (попытка ${job.attemptsMade + 1})`,
    );
    return counts;
  }
}
