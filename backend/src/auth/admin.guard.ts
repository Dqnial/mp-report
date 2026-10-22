import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './current-user.decorator';

/** Ставится поверх глобального JwtAuthGuard: req.user уже есть. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const { user } = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    if (!user) throw new ForbiddenException();

    const found = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isAdmin: true },
    });
    if (!found?.isAdmin) throw new ForbiddenException();
    return true;
  }
}
