import { Module } from '@nestjs/common';
import {
  ContactsController,
  DirectoryController,
  PlacesController,
} from './directory.controller';
import { DirectoryEditService } from './directory-edit.service';
import { DirectoryService } from './directory.service';

@Module({
  controllers: [PlacesController, ContactsController, DirectoryController],
  providers: [DirectoryService, DirectoryEditService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
