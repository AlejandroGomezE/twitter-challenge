import { instanceToPlain, plainToInstance } from 'class-transformer';
import { MyProfileResponseDto } from './my-profile-response.dto.js';
import { ProfileResponseDto } from './profile-response.dto.js';

// Same transform path the global ResponseSerializerInterceptor uses, followed
// by the JSON encoding Express applies to the body.
const options = { excludeExtraneousValues: true };

function toWire(type: new () => object, row: object): unknown {
  const plain = instanceToPlain(plainToInstance(type, row, options), options);
  return JSON.parse(JSON.stringify(plain));
}

const CREATED_AT = new Date('2026-01-02T03:04:05.678Z');
const ROW = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'someone',
  bio: 'hello',
  passwordHash: '$argon2id$secret',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

describe('ProfileResponseDto', () => {
  it('emits only { username, bio, createdAt } with createdAt as an ISO string', () => {
    expect(toWire(ProfileResponseDto, ROW)).toEqual({
      username: 'someone',
      bio: 'hello',
      createdAt: '2026-01-02T03:04:05.678Z',
    });
  });

  it('keeps a null bio as null', () => {
    expect(toWire(ProfileResponseDto, { ...ROW, bio: null })).toEqual({
      username: 'someone',
      bio: null,
      createdAt: '2026-01-02T03:04:05.678Z',
    });
  });
});

describe('MyProfileResponseDto', () => {
  it('emits only { id, email, username, bio, createdAt } with createdAt as an ISO string', () => {
    expect(toWire(MyProfileResponseDto, ROW)).toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
      bio: 'hello',
      createdAt: '2026-01-02T03:04:05.678Z',
    });
  });
});
