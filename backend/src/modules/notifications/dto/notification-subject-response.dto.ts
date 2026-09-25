import { Expose } from 'class-transformer';

// The post or comment a notification is about: its id and body only.
export class NotificationSubjectResponseDto {
  @Expose()
  id: string;

  @Expose()
  body: string;
}
