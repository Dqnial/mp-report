import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisUrl } from './redis.config';

/**
 * Общее подключение к Redis для лимита входа и кеша отчёта.
 *
 * Главное правило: недоступный Redis не ломает приложение. Команды при обрыве
 * не копятся в очереди клиента (enableOfflineQueue: false), а сразу падают —
 * вызывающий код ловит ошибку и работает без Redis. Клиент сам переподключается.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  readonly client: Redis | null;
  private down = false;

  constructor() {
    const url = redisUrl();
    this.client = url
      ? new Redis(url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
        })
      : null;
    if (!this.client) {
      this.logger.log('REDIS_URL не задан — работаем без Redis');
      return;
    }
    // пишем в лог только смену состояния, а не каждую попытку переподключения
    this.client.on('ready', () => {
      if (this.down) this.logger.log('Redis снова доступен');
      this.down = false;
    });
    this.client.on('error', (e: Error & { code?: string }) => {
      if (!this.down) {
        const reason = e.message || e.code || 'нет связи';
        this.logger.warn(`Redis недоступен (${reason}) — работаем без него`);
      }
      this.down = true;
    });
  }

  /** Подключён и готов принимать команды. */
  get ready() {
    return this.client?.status === 'ready';
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
