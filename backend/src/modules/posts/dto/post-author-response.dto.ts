import { Expose } from 'class-transformer';

// A post's (or comment's) author as embedded in responses. Deliberately no
// id or email. Only @Expose()d fields are ever serialized.
export class PostAuthorResponseDto {
  @Expose()
  username: string;
}
