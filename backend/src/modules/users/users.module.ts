import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

// Imports PostsModule (one direction only — PostsModule never imports this
// module) for the profile post count and GET /users/:username/posts.
@Module({
  imports: [PostsModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
