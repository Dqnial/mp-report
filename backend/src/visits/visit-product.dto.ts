// Отдельным файлом: плагин Swagger для класса, на который ссылаются из того же
// файла, генерирует абсолютный путь импорта — сборка ломается.
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PRODUCT_CODES, type ProductCode } from '../products';

export class VisitProductDto {
  @IsIn(PRODUCT_CODES)
  code!: ProductCode;

  /** аптека: остаток, уп. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99999)
  stock?: number;

  /** аптека: продали, уп. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99999)
  sold?: number;

  /** аптека: дозаказ, уп. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99999)
  order?: number;
}
