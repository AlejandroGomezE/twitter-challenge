import { Test } from '@nestjs/testing';
import type { Subscription } from 'rxjs';
import { MAX_STREAMS_PER_USER } from '../realtime.constants.js';
import {
  type RealtimeConnection,
  RealtimeHub,
  type RealtimeMessage,
} from '../realtime.hub.js';

interface Probe {
  connection: RealtimeConnection;
  subscription: Subscription;
  messages: RealtimeMessage[];
  completed: () => boolean;
}

describe('RealtimeHub', () => {
  let hub: RealtimeHub;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [RealtimeHub],
    }).compile();
    hub = moduleRef.get(RealtimeHub);
  });

  // Opens a connection and subscribes to it, recording what it receives.
  function open(userId: string): Probe {
    const connection = hub.connect(userId);
    const messages: RealtimeMessage[] = [];
    let done = false;
    const subscription = connection.stream.subscribe({
      next: (message) => messages.push(message),
      complete: () => {
        done = true;
      },
    });
    return { connection, subscription, messages, completed: () => done };
  }

  it('tracks connected users', () => {
    expect(hub.connectedUserIds()).toEqual([]);
    open('user-1');
    open('user-1');
    open('user-2');

    expect(hub.connectedUserIds().sort()).toEqual(['user-1', 'user-2']);
  });

  it('sendToUser delivers a JSON-encoded message to every stream of that user only', () => {
    const first = open('user-1');
    const second = open('user-1');
    const other = open('user-2');

    hub.sendToUser('user-1', 'notifications.changed', { unreadCount: 3 });

    const expected = {
      type: 'notifications.changed',
      data: '{"unreadCount":3}',
    };
    expect(first.messages).toEqual([expected]);
    expect(second.messages).toEqual([expected]);
    expect(other.messages).toEqual([]);
  });

  it('sendToUser to a user with no stream is a no-op', () => {
    expect(() =>
      hub.sendToUser('nobody', 'notifications.changed', { unreadCount: 1 }),
    ).not.toThrow();
    expect(hub.connectedUserIds()).toEqual([]);
  });

  it('broadcast reaches every connected user', () => {
    const a = open('user-1');
    const b = open('user-2');

    hub.broadcast('post.deleted', { id: 'post-1' });

    const expected = { type: 'post.deleted', data: '{"id":"post-1"}' };
    expect(a.messages).toEqual([expected]);
    expect(b.messages).toEqual([expected]);
  });

  it('broadcast skips every stream of exceptUserId', () => {
    const actorFirst = open('actor');
    const actorSecond = open('actor');
    const other = open('user-2');

    hub.broadcast(
      'post.counts',
      { id: 'post-1', likeCount: 1, commentCount: 0 },
      { exceptUserId: 'actor' },
    );

    expect(actorFirst.messages).toEqual([]);
    expect(actorSecond.messages).toEqual([]);
    expect(other.messages).toEqual([
      {
        type: 'post.counts',
        data: '{"id":"post-1","likeCount":1,"commentCount":0}',
      },
    ]);
  });

  it(`keeps at most ${MAX_STREAMS_PER_USER} streams per user, closing the oldest`, () => {
    const probes = Array.from({ length: MAX_STREAMS_PER_USER }, () =>
      open('user-1'),
    );
    const other = open('user-2');

    const newest = open('user-1');

    expect(probes[0].completed()).toBe(true);
    expect(probes.slice(1).every((probe) => !probe.completed())).toBe(true);
    expect(newest.completed()).toBe(false);
    expect(other.completed()).toBe(false);

    hub.sendToUser('user-1', 'notifications.changed', { unreadCount: 1 });
    expect(probes[0].messages).toEqual([]);
    expect(probes.slice(1).every((probe) => probe.messages.length === 1)).toBe(
      true,
    );
    expect(newest.messages).toHaveLength(1);
  });

  it('close completes the stream and removes the user once no stream is left', () => {
    const first = open('user-1');
    const second = open('user-1');

    first.connection.close();
    expect(first.completed()).toBe(true);
    expect(hub.connectedUserIds()).toEqual(['user-1']);

    second.connection.close();
    second.connection.close(); // idempotent
    expect(second.completed()).toBe(true);
    expect(hub.connectedUserIds()).toEqual([]);
  });

  it('unsubscribing (client disconnect) removes the connection', () => {
    const first = open('user-1');
    const second = open('user-1');

    first.subscription.unsubscribe();
    hub.sendToUser('user-1', 'notifications.changed', { unreadCount: 1 });
    expect(first.messages).toEqual([]);
    expect(second.messages).toHaveLength(1);

    second.subscription.unsubscribe();
    expect(hub.connectedUserIds()).toEqual([]);
  });

  it('an evicted connection frees its slot without leaking entries', () => {
    const probes = Array.from({ length: MAX_STREAMS_PER_USER + 1 }, () =>
      open('user-1'),
    );

    for (const probe of probes) {
      probe.subscription.unsubscribe();
    }

    expect(hub.connectedUserIds()).toEqual([]);
  });
});
