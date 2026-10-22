import { OmitType, PartialType } from '@nestjs/mapped-types';
import { VisitKind } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DATE_RE, MONTH_RE } from '../common/dates';
import { Clean } from '../common/transforms';
import { PRODUCTS, type VisitProduct } from '../products';
import { VisitProductDto } from './visit-product.dto';

export { VisitProductDto };

/** clientId визитов с телефона (у импортированных из файла — свой формат tpl:…). */
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export class CreateVisitDto {
  /** генерится на телефоне: повторная отправка того же визита не создаст дубль */
  @IsString()
  @Matches(CLIENT_ID_RE)
  clientId!: string;

  @Matches(DATE_RE, { message: 'date: ожидается YYYY-MM-DD' })
  date!: string;

  @IsEnum(VisitKind)
  kind!: VisitKind;

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(200)
  placeName?: string;

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(100)
  specialty?: string;

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsArray()
  // ограничения «до 4» нет: в отчёте лишние допишутся в последнюю ячейку
  @ArrayMaxSize(PRODUCTS.length)
  @ValidateNested({ each: true })
  @Type(() => VisitProductDto)
  // TS-тип — интерфейс, а схема для Swagger — явно: для поля с типом-классом
  // плагин Swagger генерирует импорт по абсолютному пути, если в пути проекта
  // есть кириллица, и сборка ломается
  @ApiProperty({ type: () => [VisitProductDto] })
  products: VisitProduct[] = [];

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /** врач: о чём договорились (переносится на следующий визит) */
  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(300)
  agreement?: string;

  /** врач: факт выполнения прошлой договорённости */
  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(300)
  fact?: string;

  /** врач: отклонение от договорённости */
  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(300)
  deviation?: string;
}

export class UpdateVisitDto extends PartialType(
  OmitType(CreateVisitDto, ['clientId'] as const),
) {}

/**
 * Офлайн-синк: полное состояние визита + время правки на устройстве.
 * Создаёт или обновляет; более старая правка, чем на сервере, игнорируется.
 */
export class SyncVisitDto extends OmitType(CreateVisitDto, [
  'clientId',
] as const) {
  @IsISO8601({ strict: true })
  updatedAt!: string;
}

export class SyncDeleteQuery {
  @IsISO8601({ strict: true })
  updatedAt!: string;
}

export class VisitSearchQuery {
  @IsString()
  @MinLength(2, { message: 'Введите хотя бы 2 символа' })
  @MaxLength(100)
  q!: string;
}

export class VisitsQuery {
  @IsOptional()
  @Matches(DATE_RE, { message: 'date: ожидается YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'month: ожидается YYYY-MM' })
  month?: string;
}
