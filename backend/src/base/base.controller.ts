import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { decodeUploadName } from '../templates/templates.controller';
import { BaseService } from './base.service';

const MAX_BASE_BYTES = 15 * 1024 * 1024;
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('base')
@ApiCookieAuth()
@Controller('base')
export class BaseController {
  constructor(private readonly base: BaseService) {}

  /** Загружен ли файл и сколько врачей и аптек в него попадёт. */
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.base.status(user.id);
  }

  /** multipart/form-data, поле file — «База врачей и аптек» от руководителя. */
  @Post('template')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BASE_BYTES } }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Прикрепите файл в поле file');
    const name = decodeUploadName(file.originalname);
    if (!/\.xlsx$/i.test(name)) {
      throw new BadRequestException('Нужен файл .xlsx');
    }
    return this.base.upload(user.id, name, file.buffer);
  }

  @Delete('template')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser) {
    return this.base.remove(user.id);
  }

  /** Готовая база под исходным именем файла. */
  @Get('file')
  async download(@CurrentUser() user: AuthUser) {
    const { file, fileName } = await this.base.build(user.id);
    return new StreamableFile(file, {
      type: XLSX_MIME,
      // filename — ASCII-запасной вариант, filename* — настоящее имя (RFC 6266)
      disposition: `attachment; filename="base.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      length: file.length,
    });
  }
}
