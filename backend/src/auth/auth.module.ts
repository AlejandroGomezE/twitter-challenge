import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from '../modules/users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionsRepository } from './sessions.repository.js';

// Brute-force protection for sign-up/sign-in: 5 requests per 60s per client
// IP, per route. ThrottlerGuard is applied per handler (not globally), so
// only the routes that opt in with @UseGuards(ThrottlerGuard) are limited.
const AUTH_THROTTLE_TTL_MS = 60_000;
const AUTH_THROTTLE_LIMIT = 5;

@Module({
  imports: [
    UsersModule,
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'auth', ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT },
      ],
      errorMessage: 'Too many requests, please try again later',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsRepository,
    // Global: protects every route by default; opt out with @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
