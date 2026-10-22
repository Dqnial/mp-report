import type { PrismaService } from '../prisma/prisma.service';
import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService', () => {
  it('удаляет истёкшие сессии и неиспользованные приглашения старше 30 дней', async () => {
    const sessions = jest.fn(() => ({ count: 3 }));
    const invites = jest.fn(() => ({ count: 1 }));
    const prisma = {
      session: { deleteMany: sessions },
      invite: { deleteMany: invites },
      $transaction: (ops: unknown[]) => Promise.all(ops),
    } as unknown as PrismaService;
    const now = new Date('2026-10-22T21:00:00Z');

    await expect(new MaintenanceService(prisma).cleanup(now)).resolves.toEqual({
      sessions: 3,
      invites: 1,
    });
    expect(sessions).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
    // использованные приглашения не трогаем — это история регистраций
    expect(invites).toHaveBeenCalledWith({
      where: {
        usedAt: null,
        expiresAt: { lt: new Date('2026-09-22T21:00:00Z') },
      },
    });
  });
});
