import { Expose, Type } from 'class-transformer';
import { PostAuthorResponseDto } from './post-author-response.dto.js';

// A comment as any signed-in viewer sees it. Only @Expose()d fields are ever
// serialized (the author's id and the post id never leave the API here).
export class CommentResponseDto {
  @Expose()
  id: string;

  @Expose()
  body: string;

  // A Date stays a Date through class-transformer; JSON makes it ISO-8601.
  @Expose()
  createdAt: Date;

  // @Type is REQUIRED on nested objects, or the whole source object would be
  // copied past the @Expose() whitelist. Covered by
  // dto/__tests__/comment-response.dto.spec.ts.
  @Expose()
  @Type(() => PostAuthorResponseDto)
  author: PostAuthorResponseDto;
}
