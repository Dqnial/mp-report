import { Injectable } from '@nestjs/common';
import { fromIsoDate, monthRange, toIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { VisitsService } from '../visits/visits.service';
import { makePlaceKindGuesser } from './place-kind';
import {
  analyzeTemplate,
  dismissPlanned,
  placeDay,
  type Dismissal,
} from './xlsx-template';

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
    // убранные из плана — не в группах, а отдельным списком (чтобы вернуть)
    const dismissed = dismissPlanned(
      [day],
      (await this.dismissedIn(userId, month)).filter((d) => d.date === date),
    ).map(({ fullName, specialty, phone, place }) => ({
      fullName,
      specialty,
      phone,
      place,
    }));

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
      dismissed,
    };
  }

  /** Врачи, убранные из плана за месяц, — для плана дня, отчёта и предпросмотра. */
  async dismissedIn(userId: string, month: string): Promise<Dismissal[]> {
    const { from, to } = monthRange(month);
    const rows = await this.prisma.planDismissal.findMany({
      where: { userId, date: { gte: from, lt: to } },
      select: { date: true, fullName: true },
    });
    return rows.map((r) => ({ date: toIsoDate(r.date), fullName: r.fullName }));
  }

  /** Убрать врача из плана дня: в плане его нет, в отчёте строка пустая. */
  async dismiss(userId: string, date: string, fullName: string) {
    const key = { userId, date: fromIsoDate(date), fullName: fullName.trim() };
    await this.prisma.planDismissal.upsert({
      where: { userId_date_fullName: key },
      create: key,
      update: {},
    });
  }

  /** Вернуть врача в план дня. */
  async restore(userId: string, date: string, fullName: string) {
    await this.prisma.planDismissal.deleteMany({
      where: { userId, date: fromIsoDate(date), fullName: fullName.trim() },
    });
  }
}
