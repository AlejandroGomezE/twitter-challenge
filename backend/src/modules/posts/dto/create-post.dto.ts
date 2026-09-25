import { IsPostBody } from '../posts.rules.js';

// Body of POST /posts. Unknown fields (e.g. an authorId) are stripped by the
// global ValidationPipe whitelist; the author comes only from the session.
export class CreatePostDto {
  // Trimmed, then 1–280 Unicode code points.
  @IsPostBody()
  body: string;
}
