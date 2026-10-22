import { Injectable, Logger } from '@nestjs/common';
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisService } from '../redis/redis.service';

/**
 * Счётчики попыток входа: в Redis — общие для всех экземпляров бэкенда и
 * переживают перезапуск; если Redis недоступен — в памяти процесса. Вход не
 * должен ломаться из-за кеша: при любой ошибке Redis считаем в памяти.
 */
@Injectable()
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler');
  private readonly memory = new ThrottlerStorageService();
  private readonly redis: ThrottlerStorageRedisService | null;

  constructor(private readonly redisService: RedisService) {
    this.redis = redisService.client
      ? new ThrottlerStorageRedisService(redisService.client)
      : null;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    if (this.redis && this.redisService.ready) {
      try {
        return await this.redis.increment(
          key,
          ttl,
          limit,
          blockDuration,
          throttlerName,
        );
      } catch (e) {
        this.logger.warn(
          `лимит в Redis не записался (${(e as Error).message}) — считаю в памяти`,
        );
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  onApplicationShutdown() {
    this.memory.onApplicationShutdown();
  }
}
