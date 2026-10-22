// .env — раньше всех модулей: от REDIS_URL зависит, подключать ли очередь
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { setupSwagger, swaggerEnabled } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // за Caddy: IP клиента — из X-Forwarded-For, но доверяем только прокси из
  // своей сети (лимит попыток входа считается по IP)
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  if (swaggerEnabled()) setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
