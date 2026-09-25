import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { CommentsController } from './comments.controller.js';
import { CommentsRepository } from './comments.repository.js';
import { CommentsService } from './comments.service.js';
import { FeedController } from './feed.controller.js';
import { PostsController } from './posts.controller.js';
import { PostsRepository } from './posts.repository.js';
import { PostsService } from './posts.service.js';

// Posts, likes and comments on them. PrismaService and the throttler
// options/storage come from global modules. PostsService is exported for the
// users module (profile post count and a user's posts); this module must not
// import UsersModule, or the two would form a cycle. FollowsModule (the
// Following feed's author set) imports neither module, so no cycle there.
@Module({
  imports: [FollowsModule],
  controllers: [PostsController, FeedController, CommentsController],
  providers: [
    PostsRepository,
    PostsService,
    CommentsRepository,
    CommentsService,
  ],
  exports: [PostsService],
})
export class PostsModule {}
