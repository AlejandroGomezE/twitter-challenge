import { Module } from '@nestjs/common';
import { FollowsController } from './follows.controller.js';
import { FollowsRepository } from './follows.repository.js';
import { FollowsService } from './follows.service.js';

// Follows between users. PrismaService and the throttler options/storage come
// from global modules. FollowsService is exported for the users module
// (profile counts and relation) and the posts module (the Following feed);
// this module must import neither, or they would form a cycle — usernames
// are resolved by FollowsRepository.
@Module({
  controllers: [FollowsController],
  providers: [FollowsRepository, FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
