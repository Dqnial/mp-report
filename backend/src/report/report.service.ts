import { Injectable } from '@nestjs/common';
import type { Visit } from '@prisma/client';
import { toIsoDate } from '../common/dates';
import { productCells, type VisitProduct } from '../products';
import { commentCellText } from './comment-cell';
import { TemplatesService } from '../templates/templates.service';
import { ReportCacheService } from './report-cache.service';
import { VisitsService } from '../visits/visits.service';
import { fillTemplate, previewDay, type VisitCells } from './xlsx-template';

const toCells = (v: Visit): VisitCells => ({
  id: v.clientId,
  date: toIsoDate(v.date),
  kind: v.kind,
  placeName: v.placeName,
  address: v.address,
  fullName: v.fullName,
  specialty: v.specialty,
  phone: v.phone,
  products: productCells(v.products as unknown as VisitProduct[]),
  comment: commentCellText(v),
});

/**
 * Отчёт собирается заново из оригинала шаблона и всех визитов месяца — или
 * берётся из кеша, если с тех пор ничего не менялось (см. ReportCacheService).
 * Отдаём под исходным именем файла.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly templates: TemplatesService,
    private readonly visits: VisitsService,
    private readonly cache: ReportCacheService,
  ) {}

  async build(userId: string, month: string) {
    const template = await this.templates.get(userId, month);
    const key = await this.cache.key(userId, month);
    const cached = key && (await this.cache.get(key));
    if (cached) return { ...cached, fileName: template.originalName };

    const visits = await this.visits.forReport(userId, month);
    const result = await fillTemplate(template.file, visits.map(toCells));
    const report = { ...result, total: visits.length };
    if (key) await this.cache.set(key, report);
    return { ...report, fileName: template.originalName };
  }

  /** Строки дня, как они будут в файле, — экран «Предпросмотр». */
  async preview(userId: string, date: string) {
    const month = date.slice(0, 7);
    const template = await this.templates.get(userId, month);
    const visits = await this.visits.forReport(userId, month);
    return previewDay(template.file, visits.map(toCells), date);
  }
}
