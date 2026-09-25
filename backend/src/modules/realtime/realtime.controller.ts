import { Controller, Inject, Req, SerializeOptions, Sse } from '@nestjs/common';
import type { Request } from 'express';
import {
  catchError,
  defer,
  endWith,
  exhaustMap,
  finalize,
  from,
  interval,
  map,
  merge,
  type Observable,
  of,
  takeWhile,
} from 'rxjs';
import { AuthService } from '../../auth/auth.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { readSessionToken } from '../../auth/session-cookie.js';
import { ServerEventResponseDto } from './dto/server-event-response.dto.js';
import { REALTIME_HEARTBEAT_INTERVAL_MS } from './realtime.constants.js';
import { RealtimeHub } from './realtime.hub.js';

// Heartbeat message: written as the SSE comment line `: ping`.
const PING: ServerEventResponseDto = { comment: 'ping' };

// Internal marker that ends the stream (session gone, or the hub closed the
// connection). Never written to the client.
const END = Symbol('END');

// GET /events: the signed-in user's Server-Sent Events stream. Gated by the
// global AuthGuard (no @Public()), so a request without a live session gets
// the guard's 401 before any stream opens. Not throttled (no ThrottlerGuard):
// EventSource reconnects on its own.
@Controller('events')
export class RealtimeController {
  constructor(
    private readonly realtimeHub: RealtimeHub,
    private readonly authService: AuthService,
    @Inject(REALTIME_HEARTBEAT_INTERVAL_MS)
    private readonly heartbeatIntervalMs: number,
  ) {}

  // The hub connection and the heartbeat timer are created on subscribe and
  // released when the client disconnects (Nest unsubscribes), when the hub
  // closes the connection (per-user limit), or when a heartbeat finds the
  // session no longer valid (sign-out or expiry) — the stream then completes
  // and the response ends.
  @Sse()
  @SerializeOptions({ type: ServerEventResponseDto })
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Observable<ServerEventResponseDto> {
    // The raw token stays in this closure only; it is re-checked on every
    // heartbeat and never stored elsewhere.
    const token = readSessionToken(request);

    return defer(() => {
      const connection = this.realtimeHub.connect(user.id);
      const heartbeat$ = interval(this.heartbeatIntervalMs).pipe(
        exhaustMap(() => this.isSessionValid(token)),
        map((valid) => (valid ? PING : END)),
      );
      return merge(connection.stream.pipe(endWith(END)), heartbeat$).pipe(
        takeWhile(
          (message): message is ServerEventResponseDto => message !== END,
        ),
        finalize(() => connection.close()),
      );
    });
  }

  // Fails closed: a lookup error ends the stream too; the client reconnects
  // and is authenticated afresh.
  private isSessionValid(token: string | undefined): Observable<boolean> {
    return from(this.authService.validateSession(token)).pipe(
      map((user) => user !== null),
      catchError(() => of(false)),
    );
  }
}
