import { IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeLogin } from '../common/transforms';

export class LoginDto {
  @NormalizeLogin()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  login!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
