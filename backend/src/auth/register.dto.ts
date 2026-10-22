import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NormalizeLogin, Trim } from '../common/transforms';

export class RegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  token!: string;

  @NormalizeLogin()
  @IsString()
  @Matches(/^[a-z0-9._-]{3,32}$/, {
    message:
      'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание',
  })
  login!: string;

  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не короче 8 символов' })
  @MaxLength(200)
  password!: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;
}
