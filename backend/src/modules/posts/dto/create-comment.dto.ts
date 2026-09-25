import { IsPostBody } from '../posts.rules.js';

// Body of POST /posts/:postId/comments. Unknown fields (e.g. an authorId or
// postId) are stripped by the global ValidationPipe whitelist; the author
// comes only from the session and the post only from the path.
export class CreateCommentDto {
  // Trimmed, then 1–280 Unicode code points (same rules as posts).
  @IsPostBody()
  body: string;
}
