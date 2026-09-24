import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { UserResponseDto } from '../modules/users/dto/user-response.dto.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './authenticated-user.interface.js';
import { CurrentUser } from './current-user.decorator.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { SignUpDto } from './dto/sign-up.dto.js';
import { Public } from './public.decorator.js';
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from './session-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // Rate-limited by the 'auth' throttler configured in AuthModule.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('sign-up')
  @SerializeOptions({ type: UserResponseDto })
  async signUp(
    @Body() dto: SignUpDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    const { user, session } = await this.authService.signUp(
      dto.email,
      dto.username,
      dto.password,
    );
    setSessionCookie(res, session.token, session.expiresAt, this.isSecure());
    return user;
  }

  // Rate-limited by the 'auth' throttler configured in AuthModule.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ type: UserResponseDto })
  async signIn(
    @Body() dto: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    const { user, session } = await this.authService.signIn(
      dto.email,
      dto.password,
    );
    setSessionCookie(res, session.token, session.expiresAt, this.isSecure());
    return user;
  }

  // Public and idempotent: signing out without (or with a stale) session
  // still clears the cookie and returns 204. No body, so no response DTO.
  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.revokeSession(readSessionToken(req));
    clearSessionCookie(res, this.isSecure());
  }

  @Get('me')
  @SerializeOptions({ type: UserResponseDto })
  me(@CurrentUser() user: AuthenticatedUser): UserResponseDto {
    return user;
  }

  private isSecure(): boolean {
    return this.configService.get<string>('nodeEnv') === 'production';
  }
}
