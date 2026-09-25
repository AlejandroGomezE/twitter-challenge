import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { SearchController } from './search.controller.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

// Imports PostsModule (the profile post count and GET /users/:username/posts)
// and FollowsModule (the profile follow counts and relation) — one direction
// only: neither ever imports this module. SearchController (GET
// /search/users) lives here because it searches users.
@Module({
  imports: [PostsModule, FollowsModule],
  controllers: [UsersController, SearchController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
