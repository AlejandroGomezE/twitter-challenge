import { HttpStatus, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { NotificationPageResponseDto } from '../dto/notification-page-response.dto.js';
import { UnreadCountResponseDto } from '../dto/unread-count-response.dto.js';
import { NotificationsController } from '../notifications.controller.js';
import { NotificationsService } from '../notifications.service.js';

// Metadata keys set by @SerializeOptions(), @HttpCode() and the route
// decorators. Nest does not export them from the @nestjs/common entry point,
// so they are mirrored here.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';
const HTTP_CODE_KEY = '__httpCode__';
const PATH_KEY = 'path';
const METHOD_KEY = 'method';

const CALLER = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'me_1',
  displayName: 'Me',
};

type Handler = 'list' | 'unreadCount' | 'markRead';

function handlerOf(name: Handler): (...args: unknown[]) => unknown {
  return (
    NotificationsController.prototype as unknown as Record<
      Handler,
      (...args: unknown[]) => unknown
    >
  )[name];
}

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const notificationsService = {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();
    controller = moduleRef.get(NotificationsController);
  });

  it('list passes the session user and the page query', async () => {
    const page = { items: [], nextCursor: null };
    notificationsService.list.mockResolvedValue(page);

    await expect(
      controller.list(CALLER, { cursor: 'c', limit: 5 }),
    ).resolves.toBe(page);
    expect(notificationsService.list).toHaveBeenCalledWith(CALLER.id, {
      cursor: 'c',
      limit: 5,
    });
  });

  it('unreadCount is the session user’s', async () => {
    notificationsService.unreadCount.mockResolvedValue({ count: 2 });

    await expect(controller.unreadCount(CALLER)).resolves.toEqual({
      count: 2,
    });
    expect(notificationsService.unreadCount).toHaveBeenCalledWith(CALLER.id);
  });

  it('markRead passes the session user and `until`', async () => {
    notificationsService.markRead.mockResolvedValue(undefined);

    await expect(
      controller.markRead(CALLER, { until: '2026-09-24T10:00:00.000Z' }),
    ).resolves.toBeUndefined();
    expect(notificationsService.markRead).toHaveBeenCalledWith(
      CALLER.id,
      '2026-09-24T10:00:00.000Z',
    );
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it('is mounted under /notifications', () => {
      expect(reflector.get(PATH_KEY, NotificationsController)).toBe(
        'notifications',
      );
    });

    it.each([
      ['list', '/', RequestMethod.GET, NotificationPageResponseDto],
      [
        'unreadCount',
        'unread-count',
        RequestMethod.GET,
        UnreadCountResponseDto,
      ],
    ] as const)(
      '%s is %s %s with its response DTO',
      (name, path, method, dto) => {
        const handler = handlerOf(name);
        expect(reflector.get(PATH_KEY, handler)).toBe(path);
        expect(reflector.get(METHOD_KEY, handler)).toBe(method);
        expect(
          reflector.get<{ type?: unknown }>(SERIALIZE_OPTIONS_KEY, handler),
        ).toEqual({ type: dto });
      },
    );

    it('markRead is POST read, 204 with no response DTO', () => {
      const handler = handlerOf('markRead');
      expect(reflector.get(PATH_KEY, handler)).toBe('read');
      expect(reflector.get(METHOD_KEY, handler)).toBe(RequestMethod.POST);
      expect(reflector.get(HTTP_CODE_KEY, handler)).toBe(HttpStatus.NO_CONTENT);
      expect(reflector.get(SERIALIZE_OPTIONS_KEY, handler)).toBeUndefined();
    });

    it.each(['list', 'unreadCount', 'markRead'] as const)(
      '%s is not @Public()',
      (name) => {
        expect(reflector.get(IS_PUBLIC_KEY, handlerOf(name))).toBeUndefined();
        expect(
          reflector.get(IS_PUBLIC_KEY, NotificationsController),
        ).toBeUndefined();
      },
    );
  });
});
