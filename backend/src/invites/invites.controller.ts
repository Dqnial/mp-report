import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { InvitesService } from './invites.service';

@ApiTags('invites')
@ApiCookieAuth()
@Controller('invites')
@UseGuards(AdminGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser) {
    return this.invites.create(user.id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.invites.list(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invites.revoke(user.id, id);
  }
}
