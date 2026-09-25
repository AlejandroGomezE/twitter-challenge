import { Expose } from 'class-transformer';

// The caller's like state on a post after PUT/DELETE /posts/:id/like.
export class LikeStateResponseDto {
  @Expose()
  liked: boolean;

  @Expose()
  likeCount: number;
}
