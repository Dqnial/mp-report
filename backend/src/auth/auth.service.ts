import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { newSecret, safeEqual, sha256, UUID_RE } from './crypto';
import type { RegisterDto } from './register.dto';

export interface Tokens {
  accessToken: string;
  /** `${sessionId}.${secret}` — в базе хранится только sha256(secret) */
  refreshToken: string;
  refreshExpiresAt: Date;
}

// сравниваем с фиктивным хешем, когда логина нет, — чтобы по времени ответа
// нельзя было понять, существует ли пользователь
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

function parseRefresh(token: string | undefined) {
  const [sessionId, secret] = token?.split('.') ?? [];
  if (!sessionId || !secret || !UUID_RE.test(sessionId)) return null;
  return { sessionId, secret };
}

@Injectable()
export class AuthService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlMs =
      Number(config.get('REFRESH_TTL_DAYS') ?? 90) * 24 * 60 * 60 * 1000;
  }

  async login(login: string, password: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }
    return this.startSession(user.id, userAgent);
  }

  /** Регистрация по одноразовому приглашению; сразу логинит. */
  async register(dto: RegisterDto, userAgent?: string) {
    const tokenHash = sha256(dto.token);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // гасим приглашение условным UPDATE: при гонке второй запрос получит 0
        const { count } = await tx.invite.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (count === 0) {
          throw new BadRequestException('Приглашение недействительно');
        }
        const created = await tx.user.create({
          data: { login: dto.login, passwordHash, fullName: dto.fullName },
        });
        await tx.invite.update({
          where: { tokenHash },
          data: { usedById: created.id },
        });
        return created;
      });
      return this.startSession(user.id, userAgent);
    } catch (e) {
      // логин занят — транзакция откатилась, приглашение осталось живым
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Такой логин уже занят');
      }
      throw e;
    }
  }

  async refresh(refreshToken: string | undefined, userAgent?: string) {
    const parsed = parseRefresh(refreshToken);
    if (!parsed) throw new UnauthorizedException();

    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
    });
    if (!session) throw new UnauthorizedException();

    if (!safeEqual(session.refreshHash, sha256(parsed.secret))) {
      // токен от живой сессии, но уже ротирован — его переиграли или украли
      await this.prisma.session.deleteMany({
        where: { userId: session.userId },
      });
      throw new UnauthorizedException();
    }
    if (session.expiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException();
    }

    // ротация + скользящий срок; условие по старому хешу защищает от гонки
    const secret = newSecret();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshHash: session.refreshHash },
      data: { refreshHash: sha256(secret), expiresAt, userAgent },
    });
    if (count === 0) throw new UnauthorizedException();

    return this.issue(session.userId, session.id, secret, expiresAt);
  }

  async logout(accessToken: string | undefined) {
    if (!accessToken) return;
    const payload = await this.jwt
      .verifyAsync<{ sub: string; sid: string }>(accessToken, {
        ignoreExpiration: true,
      })
      .catch(() => null);
    if (!payload?.sid || !UUID_RE.test(payload.sid)) return;
    await this.prisma.session.deleteMany({
      where: { id: payload.sid, userId: payload.sub },
    });
  }

  private async startSession(userId: string, userAgent?: string) {
    const secret = newSecret();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);
    const session = await this.prisma.session.create({
      data: { userId, refreshHash: sha256(secret), userAgent, expiresAt },
    });
    return this.issue(userId, session.id, secret, expiresAt);
  }

  private async issue(
    userId: string,
    sessionId: string,
    secret: string,
    refreshExpiresAt: Date,
  ): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      sid: sessionId,
    });
    return {
      accessToken,
      refreshToken: `${sessionId}.${secret}`,
      refreshExpiresAt,
    };
  }
}
