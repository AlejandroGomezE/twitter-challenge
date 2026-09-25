import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

// Imports PostsModule (the profile post count and GET /users/:username/posts)
// and FollowsModule (the profile follow counts and relation) — one direction
// only: neither ever imports this module.
@Module({
  imports: [PostsModule, FollowsModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
