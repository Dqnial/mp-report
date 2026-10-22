import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, Tokens } from './auth.service';
import {
  ACCESS_COOKIE,
  readCookie,
  REFRESH_COOKIE,
  REFRESH_PATH,
} from './cookies';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { InvitesService } from '../invites/invites.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';
import { RegisterDto } from './register.dto';

/**
 * Вход и регистрация — с ограничением попыток (против подбора пароля):
 * лимиты «auth» по IP, см. AppModule. Обновление токена, выход и профиль
 * вызываются приложением постоянно — их не ограничиваем.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  private readonly base: CookieOptions;
  private readonly accessTtlMs: number;

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly invites: InvitesService,
    config: ConfigService,
  ) {
    this.base = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE') !== 'false',
      sameSite: 'strict',
    };
    this.accessTtlMs = Number(config.get('ACCESS_TTL_SEC') ?? 900) * 1000;
  }

  @Public()
  @Post('login')
  @HttpCode(204)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(
      dto.login,
      dto.password,
      req.get('user-agent'),
    );
    this.setCookies(res, tokens);
  }

  /** Фронт проверяет ссылку до показа формы регистрации. */
  @Public()
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  @Get('invite/:token')
  @HttpCode(204)
  async checkInvite(@Param('token') token: string) {
    if (!(await this.invites.isValid(token))) {
      throw new NotFoundException('Приглашение недействительно');
    }
  }

  @Public()
  @Post('register')
  @HttpCode(204)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.register(dto, req.get('user-agent'));
    this.setCookies(res, tokens);
  }

  @Public()
  @SkipThrottle({ auth: true })
  @Post('refresh')
  @HttpCode(204)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const tokens = await this.auth.refresh(
        readCookie(req.cookies, REFRESH_COOKIE),
        req.get('user-agent'),
      );
      this.setCookies(res, tokens);
    } catch (e) {
      this.clearCookies(res);
      throw e;
    }
  }

  // refresh-кука сюда не приходит (Path=/api/auth/refresh) — сессию находим
  // по sid из access-токена; истёкший, но подписанный нами токен годится
  @Public()
  @SkipThrottle({ auth: true })
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req.cookies, ACCESS_COOKIE));
    this.clearCookies(res);
  }

  @SkipThrottle({ auth: true })
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, login: true, fullName: true, isAdmin: true },
    });
  }

  private setCookies(res: Response, t: Tokens) {
    res.cookie(ACCESS_COOKIE, t.accessToken, {
      ...this.base,
      path: '/api',
      maxAge: this.accessTtlMs,
    });
    res.cookie(REFRESH_COOKIE, t.refreshToken, {
      ...this.base,
      path: REFRESH_PATH,
      expires: t.refreshExpiresAt,
    });
  }

  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { ...this.base, path: '/api' });
    res.clearCookie(REFRESH_COOKIE, { ...this.base, path: REFRESH_PATH });
  }
}
