import { instanceToPlain, plainToInstance } from 'class-transformer';
import { UserResponseDto } from './user-response.dto.js';

describe('UserResponseDto', () => {
  it('drops every field that is not @Expose()d', () => {
    // Same transform path ClassSerializerInterceptor uses when a handler
    // declares @SerializeOptions({ type: UserResponseDto }).
    const options = { excludeExtraneousValues: true };
    const row = {
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
      bio: 'hello',
      passwordHash: '$argon2id$secret',
      createdAt: new Date(),
    };

    const plain = instanceToPlain(
      plainToInstance(UserResponseDto, row, options),
      options,
    );

    expect(plain).toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
    });
    expect(Object.keys(plain).sort()).toEqual(['email', 'id', 'username']);
  });
});
