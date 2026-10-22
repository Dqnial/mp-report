import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { DATE_RE } from '../common/dates';
import { PlanService } from './plan.service';

class PlanQuery {
  @Matches(DATE_RE, { message: 'date: ожидается YYYY-MM-DD' })
  date!: string;
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
}
