import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { DATE_RE } from '../common/dates';
import { PlanService } from './plan.service';

class PlanQuery {
  @Matches(DATE_RE, { message: 'date: ожидается YYYY-MM-DD' })
  date!: string;
}

/** Врач из плана дня — по ФИО, как в шаблоне. */
class PlanDoctorDto {
  @Matches(DATE_RE, { message: 'date: ожидается YYYY-MM-DD' })
  date!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;
}

@ApiTags('plan')
@ApiCookieAuth()
@Controller('plan')
export class PlanController {
  constructor(private readonly plan: PlanService) {}

  /** План дня из шаблона: ЛПУ, сколько строк и сколько занято. */
  @Get()
  forDay(@CurrentUser() user: AuthUser, @Query() query: PlanQuery) {
    return this.plan.forDay(user.id, query.date);
  }

  /** Убрать врача из плана дня — в отчёт его строка не попадёт. */
  @Post('dismissals')
  @HttpCode(204)
  async dismiss(@CurrentUser() user: AuthUser, @Body() body: PlanDoctorDto) {
    await this.plan.dismiss(user.id, body.date, body.fullName);
  }

  /** Вернуть врача в план дня. */
  @Delete('dismissals')
  @HttpCode(204)
  async restore(@CurrentUser() user: AuthUser, @Query() query: PlanDoctorDto) {
    await this.plan.restore(user.id, query.date, query.fullName);
  }
}
