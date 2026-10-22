import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Неиспользованные приглашения храним после истечения ещё столько — для истории. */
const EXPIRED_INVITE_KEEP_DAYS = 30;

/**
 * Уборка базы. Истёкшие refresh-сессии сами по себе не удаляются (только когда
 * их предъявят), и таблица растёт с каждым входом с нового устройства.
 */
@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async cleanup(now = new Date()) {
    const inviteCutoff = new Date(
      now.getTime() - EXPIRED_INVITE_KEEP_DAYS * 24 * 3_600_000,
    );
    const [sessions, invites] = await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.invite.deleteMany({
        where: { usedAt: null, expiresAt: { lt: inviteCutoff } },
      }),
    ]);
    return { sessions: sessions.count, invites: invites.count };
  }
}
