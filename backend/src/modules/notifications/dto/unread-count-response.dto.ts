import { Expose } from 'class-transformer';

// GET /notifications/unread-count.
export class UnreadCountResponseDto {
  @Expose()
  count: number;
}
