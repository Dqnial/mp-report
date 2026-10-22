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
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import {
  CreateContactDto,
  CreatePlaceDto,
  PlaceSearchQuery,
  SearchQuery,
  UpdateContactDto,
  UpdatePlaceDto,
} from './directory.dto';
import { DirectoryService } from './directory.service';

@Controller('places')
export class PlacesController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query() query: PlaceSearchQuery) {
    return this.directory.searchPlaces(user.id, query.q, query.kind);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlaceDto) {
    return this.directory.createPlace(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaceDto,
  ) {
    return this.directory.updatePlace(user.id, id, dto);
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

@Controller('directory')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  /** Весь справочник — для офлайн-подсказок на телефоне. */
  @Get()
  all(@CurrentUser() user: AuthUser) {
    return this.directory.all(user.id);
  }
}

@Controller('contacts')
export class ContactsController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery) {
    return this.directory.searchContacts(user.id, query.q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.directory.createContact(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.directory.updateContact(user.id, id, dto);
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
