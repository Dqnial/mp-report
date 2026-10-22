import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  PipeTransform,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import {
  CLIENT_ID_RE,
  CreateVisitDto,
  SyncDeleteQuery,
  SyncVisitDto,
  UpdateVisitDto,
  VisitSearchQuery,
  VisitsQuery,
} from './visits.dto';
import { VisitsService } from './visits.service';

class ClientIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!CLIENT_ID_RE.test(value)) throw new BadRequestException('clientId');
    return value;
  }
}

@ApiTags('visits')
@ApiCookieAuth()
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /** ?date=YYYY-MM-DD — визиты дня, ?month=YYYY-MM — месяца. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: VisitsQuery) {
    return this.visits.list(user.id, query);
  }

  /** Поиск по всем месяцам: ФИО, ЛПУ, адрес, телефон, комментарий… */
  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query() query: VisitSearchQuery) {
    return this.visits.search(user.id, query.q);
  }

  /**
   * Офлайн-синк с телефона: создать или обновить визит целиком.
   * applied=false — на сервере правка новее (с другого устройства).
   */
  @Put('sync/:clientId')
  sync(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ClientIdPipe) clientId: string,
    @Body() dto: SyncVisitDto,
  ) {
    return this.visits.sync(user.id, clientId, dto);
  }

  /** Офлайн-удаление; повтор и удаление несуществующего — тоже 204. */
  @Delete('sync/:clientId')
  @HttpCode(204)
  syncDelete(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ClientIdPipe) clientId: string,
    @Query() query: SyncDeleteQuery,
  ) {
    return this.visits.syncDelete(user.id, clientId, query.updatedAt);
  }

  /** 201 — создан, 200 — такой clientId уже был (повторная отправка). */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVisitDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { visit, created } = await this.visits.create(user.id, dto);
    res.status(created ? 201 : 200);
    return visit;
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitDto,
  ) {
    return this.visits.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.visits.remove(user.id, id);
  }
}
