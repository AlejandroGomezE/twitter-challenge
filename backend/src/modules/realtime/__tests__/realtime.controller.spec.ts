import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Observable, Subscription } from 'rxjs';
import { AuthService } from '../../../auth/auth.service.js';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { SESSION_COOKIE } from '../../../auth/session.constants.js';
import { ServerEventResponseDto } from '../dto/server-event-response.dto.js';
import {
  MAX_STREAMS_PER_USER,
  REALTIME_HEARTBEAT_INTERVAL_MS,
} from '../realtime.constants.js';
import { RealtimeController } from '../realtime.controller.js';
import { RealtimeHub } from '../realtime.hub.js';

// Metadata keys set by @SerializeOptions() and the route decorators; Nest
// does not export them from @nestjs/common, so they are mirrored here.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';
const PATH_KEY = 'path';
const METHOD_KEY = 'method';
const SSE_METADATA_KEY = '__sse__';

const HEARTBEAT_MS = 1000;
const TOKEN = 'session-token';

const CALLER = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'me_1',
  displayName: 'Me',
};

function requestWithCookie(token?: string): Request {
  return {
    cookies: token ? { [SESSION_COOKIE]: token } : {},
  } as unknown as Request;
}

interface Probe {
  subscription: Subscription;
  messages: ServerEventResponseDto[];
  completed: () => boolean;
}

function subscribe(stream: Observable<ServerEventResponseDto>): Probe {
  const messages: ServerEventResponseDto[] = [];
  let done = false;
  const subscription = stream.subscribe({
    next: (message) => messages.push(message),
    complete: () => {
      done = true;
    },
  });
  return { subscription, messages, completed: () => done };
}

describe('RealtimeController', () => {
  let controller: RealtimeController;
  let hub: RealtimeHub;

  const authService = { validateSession: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    const moduleRef = await Test.createTestingModule({
      controllers: [RealtimeController],
      providers: [
        RealtimeHub,
        { provide: AuthService, useValue: authService },
        { provide: REALTIME_HEARTBEAT_INTERVAL_MS, useValue: HEARTBEAT_MS },
      ],
    }).compile();
    controller = moduleRef.get(RealtimeController);
    hub = moduleRef.get(RealtimeHub);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is GET /events, an SSE route behind the session guard with a declared message type', () => {
    const handler = RealtimeController.prototype.events;
    expect(Reflect.getMetadata(PATH_KEY, RealtimeController)).toBe('events');
    expect(Reflect.getMetadata(METHOD_KEY, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(SSE_METADATA_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, RealtimeController)).toBe(
      undefined,
    );
    expect(Reflect.getMetadata(SERIALIZE_OPTIONS_KEY, handler)).toEqual({
      type: ServerEventResponseDto,
    });
  });

  it('connects to the hub on subscribe and forwards its messages', () => {
    const stream = controller.events(CALLER, requestWithCookie(TOKEN));
    expect(hub.connectedUserIds()).toEqual([]);

    const probe = subscribe(stream);
    expect(hub.connectedUserIds()).toEqual([CALLER.id]);

    hub.sendToUser(CALLER.id, 'notifications.changed', { unreadCount: 2 });
    expect(probe.messages).toEqual([
      { type: 'notifications.changed', data: '{"unreadCount":2}' },
    ]);
  });

  it('sends a ping comment on each heartbeat while the session is valid', async () => {
    authService.validateSession.mockResolvedValue(CALLER);
    const probe = subscribe(
      controller.events(CALLER, requestWithCookie(TOKEN)),
    );

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);
    expect(probe.messages).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(authService.validateSession).toHaveBeenCalledWith(TOKEN);
    expect(probe.messages).toEqual([{ comment: 'ping' }]);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(probe.messages).toEqual([{ comment: 'ping' }, { comment: 'ping' }]);
    expect(probe.completed()).toBe(false);
  });

  it('completes the stream and leaves the hub when the session is no longer valid', async () => {
    authService.validateSession
      .mockResolvedValueOnce(CALLER)
      .mockResolvedValueOnce(null);
    const probe = subscribe(
      controller.events(CALLER, requestWithCookie(TOKEN)),
    );

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(probe.completed()).toBe(false);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(probe.completed()).toBe(true);
    expect(probe.messages).toEqual([{ comment: 'ping' }]);
    expect(hub.connectedUserIds()).toEqual([]);

    // The heartbeat timer is gone: no further session checks.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(authService.validateSession).toHaveBeenCalledTimes(2);
  });

  it('closes the stream when the request has no session cookie any more', async () => {
    authService.validateSession.mockResolvedValue(null);
    const probe = subscribe(controller.events(CALLER, requestWithCookie()));

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(authService.validateSession).toHaveBeenCalledWith(undefined);
    expect(probe.completed()).toBe(true);
  });

  it('fails closed when the session lookup throws', async () => {
    authService.validateSession.mockRejectedValue(new Error('db down'));
    const probe = subscribe(
      controller.events(CALLER, requestWithCookie(TOKEN)),
    );

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(probe.completed()).toBe(true);
    expect(hub.connectedUserIds()).toEqual([]);
  });

  it('cleans up the hub entry and the heartbeat timer on client disconnect', async () => {
    authService.validateSession.mockResolvedValue(CALLER);
    const probe = subscribe(
      controller.events(CALLER, requestWithCookie(TOKEN)),
    );
    expect(vi.getTimerCount()).toBe(1);

    probe.subscription.unsubscribe();

    expect(hub.connectedUserIds()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(authService.validateSession).not.toHaveBeenCalled();
  });

  it('completes and stops the heartbeat when the hub closes the connection', () => {
    const probe = subscribe(
      controller.events(CALLER, requestWithCookie(TOKEN)),
    );
    // Opening more streams than allowed evicts the oldest (this one).
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      hub.connect(CALLER.id).stream.subscribe();
    }

    expect(probe.completed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
