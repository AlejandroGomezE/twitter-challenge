import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthService } from './../src/auth/auth.service.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { UsersService } from './../src/modules/users/users.service.js';

describe('App (e2e)', () => {
  let app: INestApplication;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    try {
      // Tests may touch Prisma directly for setup/teardown; sessions cascade.
      if (createdUserIds.length > 0) {
        await app
          .get(PrismaService)
          .user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    } finally {
      createdUserIds.length = 0;
      await app.close();
    }
  });

  // A valid, unique username: `e2e_` + 12 hex chars (16 chars, within 3-20).
  function uniqueUsername(): string {
    return `e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }

  // Guard: e2e must never touch the dev DB. vitest.config.e2e.ts points DATABASE_URL at a fresh
  // backend/prisma/e2e.db built by test/global-setup.ts.
  it('runs against the dedicated e2e database, not the dev DB', async () => {
    const [main] = await app
      .get(PrismaService)
      .$queryRawUnsafe<{ file: string }[]>('PRAGMA database_list');
    expect(path.basename(main.file)).toBe('e2e.db');
  });

  async function createUserWithSession(): Promise<{
    userId: string;
    username: string;
    token: string;
  }> {
    const user = await app
      .get(UsersService)
      .create(
        `e2e-${randomUUID()}@example.test`,
        uniqueUsername(),
        'correct-horse-battery',
      );
    createdUserIds.push(user.id);
    const { token } = await app.get(AuthService).createSession(user.id);
    return { userId: user.id, username: user.username, token };
  }

  // GET /auth/me is the probe for the global guard: it's gated like every
  // non-@Public() endpoint.
  it('a gated endpoint without a session returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      message: 'Authentication required',
      timestamp: expect.any(String),
      path: '/auth/me',
    });
  });

  it('a gated endpoint with a valid session returns 200', async () => {
    const { userId, token } = await createUserWithSession();
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ id: userId });
  });

  it('a gated endpoint with an expired session returns 401', async () => {
    const { userId, token } = await createUserWithSession();
    await app.get(PrismaService).session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(401);
  });

  describe('auth endpoints', () => {
    const PASSWORD = 'correct-horse-battery';
    const FRONTEND_ORIGIN = 'http://localhost:5173';

    function uniqueEmail(): string {
      return `e2e-${randomUUID()}@example.test`;
    }

    // Returns the raw Set-Cookie entry for the session cookie.
    function sessionSetCookie(res: Response): string {
      const header: string[] | string | undefined = res.headers['set-cookie'];
      const cookies = Array.isArray(header) ? header : header ? [header] : [];
      const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      if (!cookie) {
        throw new Error('No session cookie set');
      }
      return cookie;
    }

    function sessionToken(res: Response): string {
      return sessionSetCookie(res)
        .split(';')[0]
        .slice(SESSION_COOKIE.length + 1);
    }

    // Raw sign-up with an arbitrary body; tracks created users for cleanup.
    async function signUpWith(
      body: Record<string, unknown>,
    ): Promise<Response> {
      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .set('Origin', FRONTEND_ORIGIN)
        .send(body);
      if (res.status === 201) {
        createdUserIds.push((res.body as { id: string }).id);
      }
      return res;
    }

    function signUp(
      email: string,
      password = PASSWORD,
      username = uniqueUsername(),
    ): Promise<Response> {
      return signUpWith({ email, username, password });
    }

    function signIn(email: string, password: string): request.Test {
      return request(app.getHttpServer())
        .post('/auth/sign-in')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ email, password });
    }

    it('POST /auth/sign-up creates the user, sets the session cookie and returns only { id, email, username }', async () => {
      const email = uniqueEmail();
      const username = uniqueUsername();
      const res = await signUp(email, PASSWORD, username);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String), email, username });
      expect(Object.keys(res.body as object).sort()).toEqual([
        'email',
        'id',
        'username',
      ]);

      const cookie = sessionSetCookie(res);
      expect(sessionToken(res).length).toBeGreaterThan(0);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(cookie).toMatch(/;\s*Path=\/(;|$)/);
      expect(cookie).toMatch(/;\s*Expires=/i);

      const row = await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { email } });
      expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('POST /auth/sign-up hashes the same password differently for two users', async () => {
      const emailA = uniqueEmail();
      const emailB = uniqueEmail();
      expect((await signUp(emailA)).status).toBe(201);
      expect((await signUp(emailB)).status).toBe(201);

      const prisma = app.get(PrismaService);
      const a = await prisma.user.findUniqueOrThrow({
        where: { email: emailA },
      });
      const b = await prisma.user.findUniqueOrThrow({
        where: { email: emailB },
      });
      expect(a.passwordHash).not.toBe(b.passwordHash);
    });

    it('POST /auth/sign-up with an already registered email (any case/whitespace) returns 409', async () => {
      const email = uniqueEmail();
      expect((await signUp(email)).status).toBe(201);

      const res = await signUp(`  ${email.toUpperCase()}  `);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Email is already registered');
    });

    it('POST /auth/sign-up without a username returns 400', async () => {
      const res = await signUpWith({
        email: uniqueEmail(),
        password: PASSWORD,
      });
      expect(res.status).toBe(400);
    });

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(21)],
      ['with a hyphen', 'bad-name'],
      ['with a space', 'Bad Name'],
      ['reserved', 'admin'],
      ['reserved after normalization', ' ME '],
    ])(
      'POST /auth/sign-up rejects a username %s with 400',
      async (_label, username) => {
        const res = await signUp(uniqueEmail(), PASSWORD, username);
        expect(res.status).toBe(400);
      },
    );

    it('POST /auth/sign-up with a taken username (any case/whitespace) returns 409', async () => {
      const username = uniqueUsername();
      expect((await signUp(uniqueEmail(), PASSWORD, username)).status).toBe(
        201,
      );

      const res = await signUp(
        uniqueEmail(),
        PASSWORD,
        `  ${username.toUpperCase()} `,
      );
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Username is already taken');
    });

    it('POST /auth/sign-up stores the username trimmed and lowercased', async () => {
      // `  New_<HEX> ` -> `new_<hex>`; the hex suffix keeps it unique.
      const suffix = uniqueUsername().slice(4);
      const res = await signUp(
        uniqueEmail(),
        PASSWORD,
        `  New_${suffix.toUpperCase()} `,
      );

      expect(res.status).toBe(201);
      expect(res.body.username).toBe(`new_${suffix}`);
      const row = await app.get(PrismaService).user.findUniqueOrThrow({
        where: { id: (res.body as { id: string }).id },
      });
      expect(row.username).toBe(`new_${suffix}`);
    });

    it('POST /auth/sign-up rejects an invalid email and out-of-range passwords with 400', async () => {
      expect((await signUp('not-an-email')).status).toBe(400);
      expect((await signUp(uniqueEmail(), 'a'.repeat(11))).status).toBe(400);
      expect((await signUp(uniqueEmail(), 'a'.repeat(129))).status).toBe(400);
    });

    it('POST /auth/sign-in issues a fresh session; bad credentials fail identically', async () => {
      const email = uniqueEmail();
      const username = uniqueUsername();
      const signUpRes = await signUp(email, PASSWORD, username);
      expect(signUpRes.status).toBe(201);

      const ok = await signIn(email, PASSWORD).expect(200);
      expect(ok.body).toEqual({ id: expect.any(String), email, username });
      expect(Object.keys(ok.body as object).sort()).toEqual([
        'email',
        'id',
        'username',
      ]);
      expect(sessionToken(ok)).not.toBe(sessionToken(signUpRes));

      const wrongPassword = await signIn(email, 'wrong-password-123').expect(
        401,
      );
      const unknownEmail = await signIn(uniqueEmail(), PASSWORD).expect(401);
      const wrongMessage: unknown = wrongPassword.body.message;
      expect(wrongMessage).toBe('Invalid email or password');
      expect(unknownEmail.body.message).toBe(wrongMessage);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('GET /auth/me and POST /auth/sign-out manage the session lifecycle', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);

      const email = uniqueEmail();
      const username = uniqueUsername();
      const signUpRes = await signUp(email, PASSWORD, username);
      const cookie = `${SESSION_COOKIE}=${sessionToken(signUpRes)}`;

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(me.body).toEqual({ id: expect.any(String), email, username });
      expect(Object.keys(me.body as object).sort()).toEqual([
        'email',
        'id',
        'username',
      ]);

      const signOut = await request(app.getHttpServer())
        .post('/auth/sign-out')
        .set('Origin', FRONTEND_ORIGIN)
        .set('Cookie', cookie)
        .expect(204);
      const cleared = sessionSetCookie(signOut);
      expect(cleared.startsWith(`${SESSION_COOKIE}=;`)).toBe(true);
      const expires = /Expires=([^;]+)/i.exec(cleared)?.[1];
      expect(expires).toBeDefined();
      expect(new Date(expires ?? '').getTime()).toBeLessThan(Date.now());

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(401);

      // Idempotent: signing out again with the stale cookie still succeeds.
      await request(app.getHttpServer())
        .post('/auth/sign-out')
        .set('Cookie', cookie)
        .expect(204);
    });

    it('GET /auth/me emits only UserResponseDto fields even if the resolved user carries more', async () => {
      // Simulates a service accidentally returning a full Prisma row.
      const leakyUser = {
        id: 'user-1',
        email: 'leaky@example.test',
        username: 'leaky',
        passwordHash: '$argon2id$secret',
        createdAt: new Date(),
      };
      vi.spyOn(app.get(AuthService), 'validateSession').mockResolvedValue(
        leakyUser,
      );

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `${SESSION_COOKIE}=any-token`)
        .expect(200);
      expect(res.body).toEqual({
        id: 'user-1',
        email: 'leaky@example.test',
        username: 'leaky',
      });
      expect(Object.keys(res.body as object).sort()).toEqual([
        'email',
        'id',
        'username',
      ]);
    });

    it('POST /auth/sign-in from a foreign Origin returns 403', async () => {
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .set('Origin', 'http://evil.test')
        .send({ email: uniqueEmail(), password: PASSWORD })
        .expect(403);
    });

    // Throttler storage is in-memory per app instance and beforeEach builds a
    // fresh app, so this test cannot leak its counters into other tests.
    it('POST /auth/sign-in is rate limited to 5 attempts per minute', async () => {
      const email = uniqueEmail();
      for (let attempt = 0; attempt < 5; attempt++) {
        await signIn(email, PASSWORD).expect(401);
      }
      const res = await signIn(email, PASSWORD).expect(429);
      expect(res.body).toEqual({
        statusCode: 429,
        message: expect.any(String),
        timestamp: expect.any(String),
        path: '/auth/sign-in',
      });
    });
  });

  describe('users endpoints', () => {
    const FRONTEND_ORIGIN = 'http://localhost:5173';

    function cookieFor(token: string): string {
      return `${SESSION_COOKIE}=${token}`;
    }

    function getProfile(username: string, token?: string): request.Test {
      const req = request(app.getHttpServer()).get(
        `/users/${encodeURIComponent(username)}`,
      );
      return token ? req.set('Cookie', cookieFor(token)) : req;
    }

    function patchMe(
      body: Record<string, unknown>,
      token?: string,
      origin = FRONTEND_ORIGIN,
    ): request.Test {
      const req = request(app.getHttpServer())
        .patch('/users/me')
        .set('Origin', origin);
      return (token ? req.set('Cookie', cookieFor(token)) : req).send(body);
    }

    describe('GET /users/:username', () => {
      it('without a session returns 401', async () => {
        const { username } = await createUserWithSession();
        await getProfile(username).expect(401);
      });

      it("returns another user's public profile only: { username, bio, createdAt, postCount }", async () => {
        const viewer = await createUserWithSession();
        const target = await createUserWithSession();

        const res = await getProfile(target.username, viewer.token).expect(200);
        expect(Object.keys(res.body as object).sort()).toEqual([
          'bio',
          'createdAt',
          'postCount',
          'username',
        ]);
        expect(res.body).toEqual({
          username: target.username,
          bio: null,
          createdAt: expect.any(String),
          postCount: 0,
        });
        const createdAt = (res.body as { createdAt: string }).createdAt;
        expect(new Date(createdAt).toISOString()).toBe(createdAt);
      });

      it('looks the username up case-insensitively', async () => {
        const viewer = await createUserWithSession();
        const target = await createUserWithSession();

        const res = await getProfile(
          target.username.toUpperCase(),
          viewer.token,
        ).expect(200);
        expect(res.body.username).toBe(target.username);
      });

      it('an unknown username returns 404', async () => {
        const viewer = await createUserWithSession();
        const res = await getProfile(uniqueUsername(), viewer.token).expect(
          404,
        );
        expect(res.body.message).toBe('User not found');
      });

      it('GET /users/me returns 404 (reserved, never a profile)', async () => {
        const viewer = await createUserWithSession();
        await getProfile('me', viewer.token).expect(404);
      });
    });

    describe('PATCH /users/me', () => {
      it('without a session returns 401', async () => {
        await patchMe({ bio: 'hello' }).expect(401);
      });

      it('from a foreign Origin returns 403', async () => {
        const me = await createUserWithSession();
        await patchMe({ bio: 'hello' }, me.token, 'http://evil.test').expect(
          403,
        );
      });

      it("sets the bio, returns the caller's own profile and the change is visible to others", async () => {
        const me = await createUserWithSession();
        const viewer = await createUserWithSession();

        const res = await patchMe({ bio: '  Hello there  ' }, me.token).expect(
          200,
        );
        expect(Object.keys(res.body as object).sort()).toEqual([
          'bio',
          'createdAt',
          'email',
          'id',
          'postCount',
          'username',
        ]);
        expect(res.body).toEqual({
          id: me.userId,
          email: expect.any(String),
          username: me.username,
          bio: 'Hello there',
          createdAt: expect.any(String),
          postCount: 0,
        });

        const profile = await getProfile(me.username, viewer.token).expect(200);
        expect(profile.body.bio).toBe('Hello there');
      });

      it('an empty bio clears it to null', async () => {
        const me = await createUserWithSession();
        await patchMe({ bio: 'something' }, me.token).expect(200);

        const res = await patchMe({ bio: '' }, me.token).expect(200);
        expect(res.body.bio).toBeNull();
        const profile = await getProfile(me.username, me.token).expect(200);
        expect(profile.body.bio).toBeNull();
      });

      it('a bio over 160 characters returns 400', async () => {
        const me = await createUserWithSession();
        await patchMe({ bio: 'a'.repeat(161) }, me.token).expect(400);
      });

      it('changes the username: the old one 404s, the new one resolves and /auth/me reflects it', async () => {
        const me = await createUserWithSession();
        const newUsername = uniqueUsername();

        const res = await patchMe({ username: newUsername }, me.token).expect(
          200,
        );
        expect(res.body.username).toBe(newUsername);

        await getProfile(me.username, me.token).expect(404);
        const profile = await getProfile(newUsername, me.token).expect(200);
        expect(profile.body.username).toBe(newUsername);

        const authMe = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Cookie', cookieFor(me.token))
          .expect(200);
        expect(authMe.body.username).toBe(newUsername);
      });

      it('a username taken by someone else (any case) returns 409', async () => {
        const me = await createUserWithSession();
        const other = await createUserWithSession();

        const res = await patchMe(
          { username: other.username.toUpperCase() },
          me.token,
        ).expect(409);
        expect(res.body.message).toBe('Username is already taken');
      });

      it('re-setting your own current username is a 200 no-op', async () => {
        const me = await createUserWithSession();
        const res = await patchMe({ username: me.username }, me.token).expect(
          200,
        );
        expect(res.body.username).toBe(me.username);
      });

      it("only ever changes the caller's profile, even with another user's id in the body", async () => {
        const me = await createUserWithSession();
        const other = await createUserWithSession();

        const res = await patchMe(
          { id: other.userId, bio: 'x' },
          me.token,
        ).expect(200);
        expect(res.body.id).toBe(me.userId);
        expect(res.body.bio).toBe('x');

        const otherProfile = await getProfile(other.username, me.token).expect(
          200,
        );
        expect(otherProfile.body.bio).toBeNull();
      });

      it('strips unknown fields instead of rejecting them', async () => {
        const me = await createUserWithSession();
        const res = await patchMe(
          { bio: 'hi', isAdmin: true, email: 'hijack@example.test' },
          me.token,
        ).expect(200);
        expect(res.body.bio).toBe('hi');
        expect(res.body.email).not.toBe('hijack@example.test');
        expect(res.body).not.toHaveProperty('isAdmin');
      });
    });
  });
});
