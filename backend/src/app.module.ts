import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ObserveModule } from './observe.js';
import { AuthModule } from './auth/auth.module.js';
import configuration from './config/configuration.js';
import { validate } from './config/environment.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { FollowsModule } from './modules/follows/follows.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PostsModule } from './modules/posts/posts.module.js';
import { UsersModule } from './modules/users/users.module.js';

const { OBSERVE_APP_KEY, OBSERVE_APP_SECRET } = process.env;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    PostsModule,
    FollowsModule,
    NotificationsModule,
    ...(OBSERVE_APP_KEY && OBSERVE_APP_SECRET
      ? [
          ObserveModule.forRoot({
            appKey: OBSERVE_APP_KEY,
            appSecret: OBSERVE_APP_SECRET,
            serviceId: 'twitter-clone',
          }),
        ]
      : []),
  ],
})
export class AppModule {}
