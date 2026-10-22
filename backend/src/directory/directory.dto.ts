import { PartialType } from '@nestjs/mapped-types';
import { PlaceKind } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
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

export class UpdatePlaceDto extends PartialType(CreatePlaceDto) {}

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

export class UpdateContactDto extends PartialType(CreateContactDto) {}
