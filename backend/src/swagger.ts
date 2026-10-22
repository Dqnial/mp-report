import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_COOKIE } from './auth/cookies';

/**
 * Документация API (OpenAPI) — /api/docs. Схемы DTO строит плагин
 * @nestjs/swagger при сборке (nest-cli.json) из классов и class-validator.
 * В проде по умолчанию выключена: SWAGGER=true — включить.
 */
export const swaggerEnabled = () =>
  process.env.SWAGGER
    ? process.env.SWAGGER === 'true'
    : process.env.NODE_ENV !== 'production';

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Vizity API')
    .setDescription(
      'API приложения для медпредставителя: визиты, офлайн-синхронизация, ' +
        'справочник, шаблоны Excel и сборка отчёта. Все маршруты, кроме входа, ' +
        'требуют куку доступа — войдите через POST /api/auth/login, браузер ' +
        'подставит её сам.',
    )
    .setVersion('1.0')
    .addCookieAuth(ACCESS_COOKIE)
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });
}
