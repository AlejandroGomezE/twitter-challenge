import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decodeCursor, encodeCursor } from '../../posts/pagination.js';
import {
  type NotificationRow,
  NotificationsRepository,
} from '../notifications.repository.js';
import { NotificationsService } from '../notifications.service.js';

const RECIPIENT_ID = 'user-recipient';
const CREATED_AT = new Date('2026-09-24T10:00:00.000Z');
const ACTOR = { username: 'ada', displayName: 'Ada' };

function row(
  id: string,
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id,
    type: 'follow',
    createdAt: CREATED_AT,
    readAt: null,
    actor: ACTOR,
    post: null,
    comment: null,
    ...overrides,
  };
}

// `count` rows sharing one timestamp, ids descending like the repository's
// ordering.
function rows(count: number): NotificationRow[] {
  return Array.from({ length: count }, (_, index) =>
    row(`n-${String(count - index).padStart(3, '0')}`),
  );
}

describe('NotificationsService', () => {
  let service: NotificationsService;

  const notificationsRepository = {
    create: vi.fn(),
    deleteMatching: vi.fn(),
    findPage: vi.fn(),
    countUnread: vi.fn(),
    markReadUntil: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    notificationsRepository.findPage.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: notificationsRepository,
        },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  describe('list', () => {
    it('maps each row to its view (read from readAt, nested actor / post / comment)', async () => {
      const post = { id: 'post-1', body: 'my post' };
      const comment = { id: 'comment-1', body: 'nice' };
      notificationsRepository.findPage.mockResolvedValue([
        row('n-3', { type: 'comment', post, comment }),
        row('n-2', {
          type: 'like',
          post,
          readAt: new Date('2026-09-24T11:00:00.000Z'),
        }),
        row('n-1'),
      ]);

      const page = await service.list(RECIPIENT_ID, {});

      expect(page).toEqual({
        items: [
          {
            id: 'n-3',
            type: 'comment',
            createdAt: CREATED_AT,
            read: false,
            actor: ACTOR,
            post,
            comment,
          },
          {
            id: 'n-2',
            type: 'like',
            createdAt: CREATED_AT,
            read: true,
            actor: ACTOR,
            post,
            comment: null,
          },
          {
            id: 'n-1',
            type: 'follow',
            createdAt: CREATED_AT,
            read: false,
            actor: ACTOR,
            post: null,
            comment: null,
          },
        ],
        nextCursor: null,
      });
    });

    it('drops a row of an unknown type', async () => {
      notificationsRepository.findPage.mockResolvedValue([
        row('n-2', { type: 'poke' }),
        row('n-1'),
      ]);

      const page = await service.list(RECIPIENT_ID, {});

      expect(page.items.map((item) => item.id)).toEqual(['n-1']);
    });

    it('reads the first page as the recipient with the default size', async () => {
      await service.list(RECIPIENT_ID, {});

      expect(notificationsRepository.findPage).toHaveBeenCalledWith({
        recipientId: RECIPIENT_ID,
        cursor: undefined,
        limit: 20,
      });
    });

    it('returns limit items and a cursor to the last one when there are more', async () => {
      notificationsRepository.findPage.mockResolvedValue(rows(6));

      const page = await service.list(RECIPIENT_ID, { limit: 5 });

      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).not.toBeNull();
      expect(decodeCursor(page.nextCursor as string)).toEqual({
        createdAt: CREATED_AT,
        id: 'n-002',
      });
    });

    it('returns a null cursor on the last page', async () => {
      notificationsRepository.findPage.mockResolvedValue(rows(5));

      const page = await service.list(RECIPIENT_ID, { limit: 5 });

      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it('passes a decoded cursor to the repository', async () => {
      const position = { createdAt: CREATED_AT, id: 'n-010' };

      await service.list(RECIPIENT_ID, {
        cursor: encodeCursor(position),
        limit: 10,
      });

      expect(notificationsRepository.findPage).toHaveBeenCalledWith({
        recipientId: RECIPIENT_ID,
        cursor: position,
        limit: 10,
      });
    });

    it.each(['', 'not a cursor', 'bm9wZQ'])(
      'rejects cursor %j with 400 before any query',
      async (cursor) => {
        await expect(
          service.list(RECIPIENT_ID, { cursor }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(notificationsRepository.findPage).not.toHaveBeenCalled();
      },
    );
  });

  it('unreadCount wraps the repository count', async () => {
    notificationsRepository.countUnread.mockResolvedValue(4);

    await expect(service.unreadCount(RECIPIENT_ID)).resolves.toEqual({
      count: 4,
    });
    expect(notificationsRepository.countUnread).toHaveBeenCalledWith(
      RECIPIENT_ID,
    );
  });

  describe('markRead', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('marks up to `until` as read now, for the recipient only', async () => {
      const now = new Date('2026-09-24T12:00:00.000Z');
      vi.useFakeTimers({ now });

      await service.markRead(RECIPIENT_ID, '2026-09-24T10:00:00.000Z');

      expect(notificationsRepository.markReadUntil).toHaveBeenCalledWith(
        RECIPIENT_ID,
        CREATED_AT,
        now,
      );
    });
  });
});
