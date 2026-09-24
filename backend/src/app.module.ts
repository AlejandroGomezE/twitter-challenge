import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObserveModule } from './observe.js';
import { AuthModule } from './auth/auth.module.js';
import configuration from './config/configuration.js';
import { validate } from './config/environment.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { UsersModule } from './modules/users/users.module.js';

const { OBSERVE_APP_KEY, OBSERVE_APP_SECRET } = process.env;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
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
