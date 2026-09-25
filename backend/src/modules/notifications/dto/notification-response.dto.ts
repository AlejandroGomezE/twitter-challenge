import { Expose, Type } from 'class-transformer';
import { PostAuthorResponseDto } from '../../posts/dto/post-author-response.dto.js';
import type { NotificationType } from '../notifications.service.js';
import { NotificationSubjectResponseDto } from './notification-subject-response.dto.js';

// A notification as its recipient sees it. Only @Expose()d fields are ever
// serialized (no recipient / actor ids, no readAt).
export class NotificationResponseDto {
  @Expose()
  id: string;

  @Expose()
  type: NotificationType;

  // A Date stays a Date through class-transformer; JSON makes it ISO-8601.
  @Expose()
  createdAt: Date;

  @Expose()
  read: boolean;

  // @Type is REQUIRED on nested objects, or the whole source object would be
  // copied past the @Expose() whitelist. Covered by
  // dto/__tests__/notification-page-response.dto.spec.ts.
  @Expose()
  @Type(() => PostAuthorResponseDto)
  actor: PostAuthorResponseDto;

  // null for a follow.
  @Expose()
  @Type(() => NotificationSubjectResponseDto)
  post: NotificationSubjectResponseDto | null;

  // Set only for a comment notification.
  @Expose()
  @Type(() => NotificationSubjectResponseDto)
  comment: NotificationSubjectResponseDto | null;
}
