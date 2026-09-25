import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { FollowsModule } from '../follows/follows.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PostsModule } from '../posts/posts.module.js';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  REALTIME_HEARTBEAT_INTERVAL_MS,
} from './realtime.constants.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeHub } from './realtime.hub.js';
import { RealtimeListener } from './realtime.listener.js';

// Server-Sent Events transport: GET /events and the in-memory RealtimeHub
// that pushes messages to the open streams. AuthModule provides
// AuthService, which the heartbeat uses to re-validate the session.
// RealtimeListener maps domain events to stream messages, reading counts,
// follows and unread counts through the exported services of the posts,
// follows and notifications modules — none of which imports this one, so
// there is no cycle.
@Module({
  imports: [AuthModule, PostsModule, FollowsModule, NotificationsModule],
  controllers: [RealtimeController],
  providers: [
    RealtimeHub,
    RealtimeListener,
    {
      provide: REALTIME_HEARTBEAT_INTERVAL_MS,
      useValue: DEFAULT_HEARTBEAT_INTERVAL_MS,
    },
  ],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
