import { IsISO8601 } from 'class-validator';

// Body of POST /notifications/read.
export class MarkReadDto {
  // ISO-8601 date: the newest `createdAt` the client has seen. Notifications
  // created later stay unread. Strict: impossible dates (e.g. Feb 30) are a
  // 400.
  @IsISO8601({ strict: true })
  until: string;
}
