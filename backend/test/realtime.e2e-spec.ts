import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthService } from './../src/auth/auth.service.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { REALTIME_HEARTBEAT_INTERVAL_MS } from './../src/modules/realtime/realtime.constants.js';
import { RealtimeHub } from './../src/modules/realtime/realtime.hub.js';
import { UsersService } from './../src/modules/users/users.service.js';

// E2e smoke of the GET /events SSE transport. The app listens on a random
// port and streams are read with fetch, so every open stream is aborted
// explicitly (and the hub is checked empty) before the app closes — an open
// stream would otherwise keep the suite from finishing. The heartbeat is
// shortened so the session re-check is observable without waiting 25s (and
// so a waiting read wakes up at least that often to check its deadline).
//
// Domain events reach the stream asynchronously; every wait below reads the
// stream until the expected message arrives (or fails after a deadline),
// never a fixed sleep. "X got nothing" is checked by pushing a sentinel
// straight to X through the hub after the others received theirs: broadcasts
// reach every connection synchronously, so anything X was going to get is
// already queued ahead of the sentinel.

const FRONTEND_ORIGIN = 'http://localhost:5173';
const HEARTBEAT_MS = 100;
const WAIT_TIMEOUT_MS = 2000;
const WAIT_INTERVAL_MS = 5;
const SENTINEL_EVENT = 'test.sentinel';

// One parsed SSE message: its `event:` name and JSON `data:` body.
interface StreamMessage {
  event: string;
  data: unknown;
}

interface TestUser {
  userId: string;
  username: string;
  token: string;
}

interface OpenStream {
  response: Response;
  // Resolves with everything read so far once `predicate` holds for it, or
  // with null when the server ends the stream first.
  readUntil(predicate: (text: string) => boolean): Promise<string | null>;
  abort(): void;
}

describe('Realtime (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const createdUserIds: string[] = [];
  const openStreams: OpenStream[] = [];
  // Per stream, how many parsed messages the test has already consumed.
  const consumed = new Map<OpenStream, number>();

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REALTIME_HEARTBEAT_INTERVAL_MS)
      .useValue(HEARTBEAT_MS)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    try {
      for (const stream of openStreams) {
        stream.abort();
      }
      await waitFor(() => app.get(RealtimeHub).connectedUserIds().length === 0);
      if (createdUserIds.length > 0) {
        await app
          .get(PrismaService)
          .user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    } finally {
      openStreams.length = 0;
      consumed.clear();
      createdUserIds.length = 0;
      await app.close();
    }
  });

  async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error('Condition not met in time');
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
    }
  }

  async function createUserWithSession(): Promise<TestUser> {
    const user = await app
      .get(UsersService)
      .create(
        `e2e-${randomUUID()}@example.test`,
        `e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        'E2E User',
        'correct-horse-battery',
      );
    createdUserIds.push(user.id);
    const { token } = await app.get(AuthService).createSession(user.id);
    return { userId: user.id, username: user.username, token };
  }

  async function openStream(token: string): Promise<OpenStream> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/events`, {
      headers: {
        Cookie: `${SESSION_COOKIE}=${token}`,
        Origin: FRONTEND_ORIGIN,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const stream: OpenStream = {
      response,
      async readUntil(predicate) {
        while (!predicate(text)) {
          const { value, done } = await reader.read();
          if (done) {
            return null;
          }
          text += decoder.decode(value, { stream: true });
        }
        return text;
      },
      abort: () => controller.abort(),
    };
    openStreams.push(stream);
    return stream;
  }

  // Opens a stream for `user` and waits until the hub has registered it, so
  // events emitted afterwards are delivered to it.
  async function connect(user: TestUser): Promise<OpenStream> {
    const stream = await openStream(user.token);
    expect(stream.response.status).toBe(200);
    await waitFor(() =>
      app.get(RealtimeHub).connectedUserIds().includes(user.userId),
    );
    return stream;
  }

  // Complete messages in `text`, pings (comments) excluded.
  function parseMessages(text: string): StreamMessage[] {
    const blocks = text.split('\n\n').slice(0, -1);
    const messages: StreamMessage[] = [];
    for (const block of blocks) {
      let event: string | undefined;
      let data: string | undefined;
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) {
          event = line.slice('event: '.length);
        } else if (line.startsWith('data: ')) {
          data = line.slice('data: '.length);
        }
      }
      if (event !== undefined && data !== undefined) {
        messages.push({ event, data: JSON.parse(data) as unknown });
      }
    }
    return messages;
  }

  // Reads `stream` until the next unconsumed `event` message and returns
  // every message consumed on the way (the match last). Fails after
  // WAIT_TIMEOUT_MS; the heartbeat wakes the read up to check the deadline.
  async function readThrough(
    stream: OpenStream,
    event: string,
  ): Promise<StreamMessage[]> {
    const start = consumed.get(stream) ?? 0;
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    let matched: StreamMessage[] | undefined;
    const text = await stream.readUntil((t) => {
      const pending = parseMessages(t).slice(start);
      const index = pending.findIndex((message) => message.event === event);
      if (index >= 0) {
        matched = pending.slice(0, index + 1);
        return true;
      }
      if (Date.now() > deadline) {
        throw new Error(`No ${event} message in time`);
      }
      return false;
    });
    if (text === null || !matched) {
      throw new Error(`Stream ended before a ${event} message`);
    }
    consumed.set(stream, start + matched.length);
    return matched;
  }

  // The data of the next `event` message on `stream`.
  async function nextData(stream: OpenStream, event: string): Promise<unknown> {
    const messages = await readThrough(stream, event);
    return messages.at(-1)!.data;
  }

  // Names of the messages `user` received since the last read, up to a
  // sentinel pushed to them now.
  async function eventsUntilSentinel(
    user: TestUser,
    stream: OpenStream,
  ): Promise<string[]> {
    app.get(RealtimeHub).sendToUser(user.userId, SENTINEL_EVENT, {});
    const messages = await readThrough(stream, SENTINEL_EVENT);
    return messages.slice(0, -1).map((message) => message.event);
  }

  async function call(
    method: 'post' | 'put' | 'delete',
    path: string,
    user: TestUser,
    body?: object,
  ): Promise<request.Response> {
    const req = request(app.getHttpServer())
      [method](path)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE}=${user.token}`);
    return body ? req.send(body) : req;
  }

  async function createPost(user: TestUser): Promise<string> {
    const res = await call('post', '/posts', user, { body: 'Hello stream' });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  async function follow(me: TestUser, target: TestUser): Promise<void> {
    const res = await call('put', `/users/${target.username}/follow`, me);
    expect(res.status).toBe(200);
  }

  it('GET /events without a session is 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/events')
      .set('Origin', FRONTEND_ORIGIN);

    expect(res.status).toBe(401);
  });

  it('GET /events with an unknown session is 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/events')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE}=not-a-session`);

    expect(res.status).toBe(401);
  });

  it('opens a credentialed event stream that delivers hub messages and pings', async () => {
    const user = await createUserWithSession();
    const stream = await openStream(user.token);

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain(
      'text/event-stream',
    );
    expect(stream.response.headers.get('access-control-allow-origin')).toBe(
      FRONTEND_ORIGIN,
    );
    expect(
      stream.response.headers.get('access-control-allow-credentials'),
    ).toBe('true');
    expect(stream.response.headers.get('content-encoding')).toBeNull();

    await waitFor(() =>
      app.get(RealtimeHub).connectedUserIds().includes(user.userId),
    );
    app
      .get(RealtimeHub)
      .sendToUser(user.userId, 'notifications.changed', { unreadCount: 4 });

    const text = await stream.readUntil(
      (t) => t.includes('"unreadCount":4') && t.includes(': ping\n\n'),
    );
    expect(text).toContain(
      'event: notifications.changed\nid: 1\ndata: {"unreadCount":4}\n\n',
    );
    expect(text).toContain(': ping\n\n');

    stream.abort();
    await waitFor(() => app.get(RealtimeHub).connectedUserIds().length === 0);
  });

  it('closes the stream on the next heartbeat after the session is revoked', async () => {
    const user = await createUserWithSession();
    const stream = await openStream(user.token);
    expect(stream.response.status).toBe(200);
    await waitFor(() =>
      app.get(RealtimeHub).connectedUserIds().includes(user.userId),
    );

    await app.get(AuthService).revokeSession(user.token);

    // The server ends the response: the read reaches end-of-stream.
    await expect(stream.readUntil(() => false)).resolves.toBeNull();
    expect(app.get(RealtimeHub).connectedUserIds()).toEqual([]);
  });

  it('post.created reaches every other connected user with their following flag', async () => {
    const author = await createUserWithSession();
    const follower = await createUserWithSession();
    const stranger = await createUserWithSession();
    await follow(follower, author);
    const authorStream = await connect(author);
    const followerStream = await connect(follower);
    const strangerStream = await connect(stranger);

    const postId = await createPost(author);

    await expect(nextData(followerStream, 'post.created')).resolves.toEqual({
      id: postId,
      following: true,
    });
    await expect(nextData(strangerStream, 'post.created')).resolves.toEqual({
      id: postId,
      following: false,
    });
    expect(await eventsUntilSentinel(author, authorStream)).not.toContain(
      'post.created',
    );
  });

  it('post.counts follows likes and comments, for everyone but the actor', async () => {
    const author = await createUserWithSession();
    const actor = await createUserWithSession();
    const viewer = await createUserWithSession();
    const postId = await createPost(author);
    const actorStream = await connect(actor);
    const viewerStream = await connect(viewer);

    expect((await call('put', `/posts/${postId}/like`, actor)).status).toBe(
      200,
    );
    await expect(nextData(viewerStream, 'post.counts')).resolves.toEqual({
      id: postId,
      likeCount: 1,
      commentCount: 0,
    });

    const comment = await call('post', `/posts/${postId}/comments`, actor, {
      body: 'Nice',
    });
    expect(comment.status).toBe(201);
    await expect(nextData(viewerStream, 'post.counts')).resolves.toEqual({
      id: postId,
      likeCount: 1,
      commentCount: 1,
    });

    expect((await call('delete', `/posts/${postId}/like`, actor)).status).toBe(
      200,
    );
    await expect(nextData(viewerStream, 'post.counts')).resolves.toEqual({
      id: postId,
      likeCount: 0,
      commentCount: 1,
    });

    const commentId = (comment.body as { id: string }).id;
    expect(
      (await call('delete', `/posts/${postId}/comments/${commentId}`, actor))
        .status,
    ).toBe(204);
    await expect(nextData(viewerStream, 'post.counts')).resolves.toEqual({
      id: postId,
      likeCount: 0,
      commentCount: 0,
    });

    expect(await eventsUntilSentinel(actor, actorStream)).not.toContain(
      'post.counts',
    );
  });

  it('notifications.changed carries the unread count to the recipient only', async () => {
    const actor = await createUserWithSession();
    const recipient = await createUserWithSession();
    const actorStream = await connect(actor);
    const recipientStream = await connect(recipient);

    await follow(actor, recipient);
    await expect(
      nextData(recipientStream, 'notifications.changed'),
    ).resolves.toEqual({ unreadCount: 1 });

    const read = await call('post', '/notifications/read', recipient, {
      until: new Date().toISOString(),
    });
    expect(read.status).toBe(204);
    await expect(
      nextData(recipientStream, 'notifications.changed'),
    ).resolves.toEqual({ unreadCount: 0 });

    expect(await eventsUntilSentinel(actor, actorStream)).not.toContain(
      'notifications.changed',
    );
  });

  it('post.deleted reaches every connected user but the author', async () => {
    const author = await createUserWithSession();
    const viewer = await createUserWithSession();
    const postId = await createPost(author);
    const authorStream = await connect(author);
    const viewerStream = await connect(viewer);

    expect((await call('delete', `/posts/${postId}`, author)).status).toBe(204);

    await expect(nextData(viewerStream, 'post.deleted')).resolves.toEqual({
      id: postId,
    });
    expect(await eventsUntilSentinel(author, authorStream)).not.toContain(
      'post.deleted',
    );
  });
});
