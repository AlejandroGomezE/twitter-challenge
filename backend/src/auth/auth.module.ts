import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from '../modules/users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { THROTTLERS } from './throttlers.js';

// Rate limiting (ThrottlerModule is global; configured once, here). Brute-force
// protection for sign-up/sign-in: 5 requests per 60s per client IP, per route
// ('auth' throttler); signed-in write routes are limited per session user
// ('user' throttler) — see throttlers.ts. ThrottlerGuard is applied per
// handler (not globally), so only the routes that opt in with
// @UseGuards(ThrottlerGuard) are limited.
@Module({
  imports: [
    UsersModule,
    ThrottlerModule.forRoot({
      throttlers: THROTTLERS,
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
