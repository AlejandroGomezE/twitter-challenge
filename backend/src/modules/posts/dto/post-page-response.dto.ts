import { Expose, Type } from 'class-transformer';
import { PostResponseDto } from './post-response.dto.js';

// One page of posts, newest first. Only @Expose()d fields are ever
// serialized.
export class PostPageResponseDto {
  // @Type is REQUIRED on nested arrays too: without it each item would be
  // copied as an untyped plain object, bypassing PostResponseDto's @Expose()
  // whitelist. Covered by dto/__tests__/post-page-response.dto.spec.ts.
  @Expose()
  @Type(() => PostResponseDto)
  items: PostResponseDto[];

  // Pass it back as `?cursor=` for the next page; null on the last page.
  @Expose()
  nextCursor: string | null;
}
