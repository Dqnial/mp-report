import { Injectable } from '@nestjs/common';
import { toIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { VisitsService } from '../visits/visits.service';
import { makePlaceKindGuesser } from './place-kind';
import { analyzeTemplate, placeDay } from './xlsx-template';

/**
 * План дня из шаблона: группы «ЛПУ + строки под ним» и сколько уже занято
 * (записано в файле + визиты из приложения). Считается той же раскладкой,
 * что и отчёт, — что видно на экране, то и попадёт в файл.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly visits: VisitsService,
  ) {}

  async forDay(userId: string, date: string) {
    const month = date.slice(0, 7);
    const template = await this.templates.find(userId, month);
    if (!template) return { hasTemplate: false, inTemplate: false, groups: [] };

    const info = await analyzeTemplate(template.file);
    const day = info.days.find((d) => d.date === date);
    if (!day) return { hasTemplate: true, inTemplate: false, groups: [] };

    const dayVisits = (await this.visits.forReport(userId, month)).filter(
      (v) => toIsoDate(v.date) === date,
    );
    const { groups } = placeDay(day, dayVisits);

    // врач или аптека — колонке C не верим, см. place-kind.ts
    const kindOf = makePlaceKindGuesser(
      await this.prisma.place.findMany({
        where: { userId },
        select: { name: true, kind: true, updatedAt: true },
      }),
    );

    return {
      hasTemplate: true,
      inTemplate: true,
      groups: groups.map((g) => ({ ...g, kind: kindOf(g.place, g.label) })),
    };
  }
}
