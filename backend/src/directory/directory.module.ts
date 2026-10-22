import { Module } from '@nestjs/common';
import {
  ContactsController,
  DirectoryController,
  PlacesController,
} from './directory.controller';
import { DirectoryService } from './directory.service';

@Module({
  controllers: [PlacesController, ContactsController, DirectoryController],
  providers: [DirectoryService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
