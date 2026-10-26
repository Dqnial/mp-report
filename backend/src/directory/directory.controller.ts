import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import {
  CreateContactDto,
  CreatePlaceDto,
  PlaceSearchQuery,
  SearchQuery,
  EditContactDto,
  EditPlaceDto,
} from './directory.dto';
import { DirectoryEditService } from './directory-edit.service';
import { DirectoryService } from './directory.service';

@ApiTags('directory')
@ApiCookieAuth()
@Controller('places')
export class PlacesController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly editor: DirectoryEditService,
  ) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query() query: PlaceSearchQuery) {
    return this.directory.searchPlaces(user.id, query.q, query.kind);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlaceDto) {
    return this.directory.createPlace(user.id, dto);
  }

  /** Правка места (название, адрес, «не включать в базу»). */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditPlaceDto,
  ) {
    return this.editor.editPlace(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.directory.deletePlace(user.id, id);
  }
}

@ApiTags('directory')
@ApiCookieAuth()
@Controller('directory')
export class DirectoryController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly editor: DirectoryEditService,
  ) {}

  /** Весь справочник — для офлайн-подсказок на телефоне. */
  @Get()
  all(@CurrentUser() user: AuthUser) {
    return this.directory.all(user.id);
  }

  /** Экран «Справочник»: врачи и аптеки как в базе, с числом визитов. */
  @Get('entries')
  entries(@CurrentUser() user: AuthUser) {
    return this.editor.entries(user.id);
  }
}

@ApiTags('directory')
@ApiCookieAuth()
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly editor: DirectoryEditService,
  ) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery) {
    return this.directory.searchContacts(user.id, query.q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.directory.createContact(user.id, dto);
  }

  /** Правка врача/провизора; с fixVisitsFrom — и тех же значений в визитах. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditContactDto,
  ) {
    return this.editor.editContact(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.directory.deleteContact(user.id, id);
  }
}
