import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ResilientThrottlerStorage } from './auth/throttler-storage';
import { DirectoryModule } from './directory/directory.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PrismaModule } from './prisma/prisma.module';
import { bullConnection, redisEnabled } from './redis/redis.config';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { ReportModule } from './report/report.module';
import { TemplatesModule } from './templates/templates.module';
import { VisitsModule } from './visits/visits.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    // попытки входа и регистрации: 5 в минуту с одного IP, дальше — пауза 5 минут
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          { name: 'auth', ttl: 60_000, limit: 5, blockDuration: 5 * 60_000 },
        ],
        storage: new ResilientThrottlerStorage(redis),
        errorMessage:
          'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
      }),
    }),
    // очереди BullMQ — только при наличии Redis (см. redis.config.ts)
    ...(redisEnabled()
      ? [
          BullModule.forRoot({
            connection: bullConnection(),
            prefix: 'mp',
          }),
        ]
      : []),
    AuthModule,
    DirectoryModule,
    VisitsModule,
    TemplatesModule,
    ReportModule,
    MaintenanceModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
