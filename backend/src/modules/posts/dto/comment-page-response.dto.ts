import { Expose, Type } from 'class-transformer';
import { CommentResponseDto } from './comment-response.dto.js';

// One page of a post's comments, oldest first. Only @Expose()d fields are
// ever serialized.
export class CommentPageResponseDto {
  // @Type is REQUIRED on nested arrays too (see CommentResponseDto).
  @Expose()
  @Type(() => CommentResponseDto)
  items: CommentResponseDto[];

  // Pass it back as `?cursor=` for the next page; null on the last page.
  @Expose()
  nextCursor: string | null;
}
