import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { quietRedisErrors } from '../redis/quiet-errors';
import { MaintenanceService } from './maintenance.service';

export const MAINTENANCE_QUEUE = 'maintenance';

/** Каждую ночь в 02:00 по UTC+5 (21:00 UTC) — когда приложением не пользуются. */
export const CLEANUP_CRON = '0 21 * * *';

/**
 * Задачи по расписанию через BullMQ (job scheduler): расписание хранится в
 * Redis, поэтому при нескольких экземплярах бэкенда задача выполняется один
 * раз, а не на каждом. upsert — повторный старт не плодит дубликатов.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger('Maintenance');

  constructor(
    private readonly maintenance: MaintenanceService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
    this.queue.on('error', quietRedisErrors(this.logger, 'очередь уборки'));
  }

  private readonly onRedisError = quietRedisErrors(
    this.logger,
    'воркер уборки',
  );

  @OnWorkerEvent('error')
  onError(e: Error) {
    this.onRedisError(e);
  }

  // не ждём: недоступный Redis не должен задерживать старт приложения
  onApplicationBootstrap() {
    void this.schedule();
  }

  private async schedule() {
    try {
      await this.queue.upsertJobScheduler(
        'nightly-cleanup',
        { pattern: CLEANUP_CRON, tz: 'UTC' },
        {
          name: 'cleanup',
          opts: {
            removeOnComplete: { count: 30 },
            removeOnFail: { count: 30 },
          },
        },
      );
    } catch (e) {
      // без расписания приложение работает — уборка просто подождёт
      this.logger.warn(
        `не удалось задать расписание уборки: ${(e as Error).message}`,
      );
    }
  }

  async process() {
    const removed = await this.maintenance.cleanup();
    this.logger.log(
      `уборка: истёкших сессий ${removed.sessions}, старых приглашений ${removed.invites}, ` +
        `из справочника без визитов — врачей ${removed.contacts}, мест ${removed.places}`,
    );
    return removed;
  }
}
