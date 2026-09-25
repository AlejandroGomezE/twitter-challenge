import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

// Notifications of follows, likes and comments. They are created by
// NotificationsListener from the domain events (common/events/) that the
// posts and follows modules emit, so this module imports neither of them and
// they stay unaware of it. PrismaService and EventEmitter2 come from global
// modules.
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsListener,
  ],
})
export class NotificationsModule {}
