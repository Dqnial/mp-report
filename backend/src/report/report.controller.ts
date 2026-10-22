import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { DATE_RE } from '../common/dates';
import { MonthPipe } from '../common/month.pipe';
import { ReportService } from './report.service';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class PreviewQuery {
  @Matches(DATE_RE, { message: 'date: ожидается YYYY-MM-DD' })
  date!: string;
}

@ApiTags('reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  /** Строки дня как в готовом файле. Объявлен раньше ':month' — иначе «preview» сочтётся месяцем. */
  @Get('preview')
  preview(@CurrentUser() user: AuthUser, @Query() query: PreviewQuery) {
    return this.reports.preview(user.id, query.date);
  }

  /** Что попадёт в отчёт — фронт показывает предупреждения перед отправкой. */
  @Get(':month/check')
  async check(
    @CurrentUser() user: AuthUser,
    @Param('month', MonthPipe) month: string,
  ) {
    const { placed, total, warnings, fileName, version } =
      await this.reports.build(user.id, month);
    return { fileName, placed, total, warnings, version };
  }

  /**
   * Готовый xlsx под исходным именем. Версия — в заголовке X-Report-Version:
   * телефон хранит файл под ней и не скачивает его снова, пока она та же.
   */
  @Get(':month')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('month', MonthPipe) month: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, fileName, version } = await this.reports.build(
      user.id,
      month,
    );
    if (version) res.setHeader('X-Report-Version', version);
    return new StreamableFile(file, {
      type: XLSX_MIME,
      // filename — ASCII-запасной вариант, filename* — настоящее имя (RFC 6266)
      disposition: `attachment; filename="report-${month}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      length: file.length,
    });
  }
}
