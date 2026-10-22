import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { newSecret, sha256, UUID_RE } from '../auth/crypto';

@Injectable()
export class InvitesService {
  private readonly ttlMs: number;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs =
      Number(config.get('INVITE_TTL_DAYS') ?? 7) * 24 * 60 * 60 * 1000;
    this.appUrl = config.getOrThrow<string>('APP_URL').replace(/\/+$/, '');
  }

  /** Токен виден только в ответе на создание — в базе лишь его хеш. */
  async create(createdById: string) {
    const token = newSecret();
    const invite = await this.prisma.invite.create({
      data: {
        tokenHash: sha256(token),
        createdById,
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return {
      id: invite.id,
      url: `${this.appUrl}/invite/${token}`,
      expiresAt: invite.expiresAt,
    };
  }

  /** Свои приглашения: если админов станет несколько, чужие не видны. */
  list(createdById: string) {
    return this.prisma.invite.findMany({
      where: { createdById },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        createdBy: { select: { fullName: true } },
        usedBy: { select: { login: true, fullName: true } },
      },
    });
  }

  /** Отозвать можно только своё неиспользованное приглашение. */
  async revoke(createdById: string, id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const { count } = await this.prisma.invite.deleteMany({
      where: { id, createdById, usedAt: null },
    });
    if (count === 0) throw new NotFoundException();
  }

  async isValid(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      select: { usedAt: true, expiresAt: true },
    });
    return !!invite && !invite.usedAt && invite.expiresAt > new Date();
  }
}
