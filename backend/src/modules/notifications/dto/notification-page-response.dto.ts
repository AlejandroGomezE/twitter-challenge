import { Expose, Type } from 'class-transformer';
import { NotificationResponseDto } from './notification-response.dto.js';

// GET /notifications: one page, newest first. Only @Expose()d fields are
// ever serialized.
export class NotificationPageResponseDto {
  // @Type is REQUIRED on nested arrays (see PostPageResponseDto).
  @Expose()
  @Type(() => NotificationResponseDto)
  items: NotificationResponseDto[];

  // Pass it back as `?cursor=` for the next page; null on the last page.
  @Expose()
  nextCursor: string | null;
}
