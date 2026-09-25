import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthService } from './../src/auth/auth.service.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { UsersService } from './../src/modules/users/users.service.js';

// The global ValidationPipe runs without implicit conversion: a value keeps the JSON type the
// client sent, so a number or boolean in a string field is a 400, never silently coerced.
describe('Strict request validation (e2e)', () => {
  const FRONTEND_ORIGIN = 'http://localhost:5173';
  const PASSWORD = 'correct-horse-battery';
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

  function uniqueUsername(): string {
    return `e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }

  function uniqueEmail(): string {
    return `e2e-${randomUUID()}@example.test`;
  }

  async function createUserWithSession(): Promise<{ username: string; cookie: string }> {
    const user = await app.get(UsersService).create(uniqueEmail(), uniqueUsername(), 'E2E User', PASSWORD);
    createdUserIds.push(user.id);
    const { token } = await app.get(AuthService).createSession(user.id);
    return { username: user.username, cookie: `${SESSION_COOKIE}=${token}` };
  }

  async function usersMatching(email: string, username: string): Promise<number> {
    return app
      .get(PrismaService)
      .user.count({ where: { OR: [{ email }, { username }] } });
  }

  describe('POST /auth/sign-up', () => {
    it.each([
      ['a numeric username', { username: 123456 }],
      ['a boolean username', { username: true }],
      ['a numeric password', { password: 123456789012 }],
      ['a numeric email', { email: 42 }],
      ['a numeric displayName', { displayName: 42 }],
    ])('rejects %s with 400 and creates nothing', async (_label, override) => {
      const email = uniqueEmail();
      const username = uniqueUsername();

      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ email, password: PASSWORD, username, displayName: 'E2E User', ...override })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      // Scoped to this request's identifiers: other e2e files create users in parallel.
      expect(await usersMatching(email, username)).toBe(0);
    });

    it('still accepts a well-typed body', async () => {
      const username = uniqueUsername();
      const res = await request(app.getHttpServer())
        .post('/auth/sign-up')
        .set('Origin', FRONTEND_ORIGIN)
        .send({ email: uniqueEmail(), password: PASSWORD, username, displayName: 'E2E User' })
        .expect(201);

      createdUserIds.push(res.body.id);
      expect(res.body.username).toBe(username);
    });
  });

  describe('POST /auth/sign-in', () => {
    it.each([
      ['a numeric email', { email: 42, password: PASSWORD }],
      ['a numeric password', { email: 'someone@example.test', password: 123456789012 }],
    ])('rejects %s with 400', async (_label, body) => {
      await request(app.getHttpServer())
        .post('/auth/sign-in')
        .set('Origin', FRONTEND_ORIGIN)
        .send(body)
        .expect(400);
    });
  });

  describe('PATCH /users/me', () => {
    it.each([
      ['a boolean bio', { bio: true }],
      ['a numeric bio', { bio: 123 }],
      ['a numeric username', { username: 123456 }],
      ['a numeric displayName', { displayName: 123456 }],
    ])('rejects %s with 400 and changes nothing', async (_label, body) => {
      const { username, cookie } = await createUserWithSession();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', cookie)
        .set('Origin', FRONTEND_ORIGIN)
        .send(body)
        .expect(400);

      const profile = await request(app.getHttpServer())
        .get(`/users/${username}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(profile.body).toMatchObject({ username, bio: null, displayName: 'E2E User' });
    });

    it('still accepts well-typed values', async () => {
      const { cookie } = await createUserWithSession();

      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', cookie)
        .set('Origin', FRONTEND_ORIGIN)
        .send({ bio: 'Plain text bio' })
        .expect(200);

      expect(res.body.bio).toBe('Plain text bio');
    });
  });
});
