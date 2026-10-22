import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { MonthPipe } from '../common/month.pipe';
import { TemplatesService } from './templates.service';

const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;

/**
 * multer отдаёт имя файла, декодированное как latin1, — кириллица ломается.
 * Имя менять нельзя (требование компании), поэтому перекодируем обратно.
 */
export function decodeUploadName(name: string) {
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-ÿ]/.test(name)) return name; // уже нормальный юникод
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

@ApiTags('templates')
@ApiCookieAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** multipart/form-data, поле file — xlsx от руководителя. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_TEMPLATE_BYTES } }),
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
    return this.templates.upload(user.id, name, file.buffer);
  }

  /** Состояние фонового импорта строк файла (после POST /templates). */
  @Get('import/:jobId')
  importStatus(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.templates.importStatus(user.id, jobId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user.id);
  }

  @Delete(':month')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('month', MonthPipe) month: string,
  ) {
    return this.templates.remove(user.id, month);
  }
}
