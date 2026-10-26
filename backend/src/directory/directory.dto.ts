import { PlaceKind, Potential } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DATE_RE } from '../common/dates';
import { Clean } from '../common/transforms';

export class SearchQuery {
  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class PlaceSearchQuery extends SearchQuery {
  @IsOptional()
  @IsEnum(PlaceKind)
  kind?: PlaceKind;
}

export class CreatePlaceDto {
  @IsEnum(PlaceKind)
  kind!: PlaceKind;

  @Clean()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class CreateContactDto {
  @Clean()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

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

  @IsOptional()
  @IsUUID()
  placeId?: string;
}

/**
 * Правка в экране «Справочник». Пустая строка — стереть поле. Визиты с
 * fixVisitsFrom (первое число текущего месяца на телефоне) исправляются
 * вместе со справочником — там, где было старое значение.
 */
class DirectoryEditDto {
  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(300)
  address?: string;

  /** не включать в «Базу врачей и аптек» */
  @IsOptional()
  @IsBoolean()
  hiddenFromBase?: boolean;

  @IsOptional()
  @Matches(DATE_RE, { message: 'fixVisitsFrom: ожидается YYYY-MM-DD' })
  fixVisitsFrom?: string;
}

export class EditContactDto extends DirectoryEditDto {
  @IsOptional()
  @Clean()
  @IsString()
  @MinLength(1)
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

  /** ЛПУ врача или аптека провизора: другое — врач переходит в другое место */
  @IsOptional()
  @Clean()
  @IsString()
  @MaxLength(200)
  placeName?: string;

  /** null — снять */
  @IsOptional()
  @IsEnum(Potential)
  potential?: Potential | null;
}

export class EditPlaceDto extends DirectoryEditDto {
  @IsOptional()
  @Clean()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}
