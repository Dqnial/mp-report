import { BadRequestException, PipeTransform } from '@nestjs/common';
import { MONTH_RE } from './dates';

/** Параметр пути вида 2026-10. */
export class MonthPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!MONTH_RE.test(value)) {
      throw new BadRequestException('Месяц в формате YYYY-MM');
    }
    return value;
  }
}
