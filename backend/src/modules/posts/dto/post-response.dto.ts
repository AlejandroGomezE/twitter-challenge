import { Expose, Type } from 'class-transformer';
import { PostAuthorResponseDto } from './post-author-response.dto.js';

// A post as any signed-in viewer sees it. Only @Expose()d fields are ever
// serialized (the author's id never leaves the API).
export class PostResponseDto {
  @Expose()
  id: string;

  @Expose()
  body: string;

  // class-transformer keeps a Date instance as a Date (no @Type needed), so
  // the JSON body carries an ISO-8601 string.
  @Expose()
  createdAt: Date;

  // @Type is REQUIRED on every nested object: without it class-transformer
  // copies the nested value as an untyped plain object, bypassing the
  // @Expose() whitelist — every key of the source (ids, email, even a
  // passwordHash) would leak. Covered by dto/__tests__/post-response.dto.spec.ts.
  @Expose()
  @Type(() => PostAuthorResponseDto)
  author: PostAuthorResponseDto;

  @Expose()
  likeCount: number;

  @Expose()
  commentCount: number;

  @Expose()
  likedByMe: boolean;
}
