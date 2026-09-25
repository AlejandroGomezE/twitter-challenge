import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { MAX_STREAMS_PER_USER } from './realtime.constants.js';

// One SSE message (a Nest RealtimeMessage): `type` is the `event:` name and
// `data` the JSON-encoded body.
export interface RealtimeMessage {
  type: string;
  data: string;
}

// One open stream, as handed out by RealtimeHub.connect().
export interface RealtimeConnection {
  // Messages for this connection. Unsubscribing removes the connection from
  // the hub; the stream completes when the connection is closed.
  stream: Observable<RealtimeMessage>;
  // Removes the connection and completes its stream. Idempotent.
  close(): void;
}

export interface BroadcastOptions {
  // Skips every connection of this user (e.g. the actor, whose client has
  // already applied the change optimistically).
  exceptUserId?: string;
}

// In-memory registry of the open GET /events streams, keyed by user id. It
// only lives in this process: running more than one backend instance would
// need a shared pub/sub (e.g. Redis) to fan messages out — see the
// realtime-updates feature decisions.
@Injectable()
export class RealtimeHub {
  // Per user, the connections in the order they were opened (a Set keeps
  // insertion order), so the first one is the oldest.
  private readonly connections = new Map<
    string,
    Set<Subject<RealtimeMessage>>
  >();

  connect(userId: string): RealtimeConnection {
    const subject = new Subject<RealtimeMessage>();
    let userConnections = this.connections.get(userId);
    if (!userConnections) {
      userConnections = new Set();
      this.connections.set(userId, userConnections);
    }
    userConnections.add(subject);

    // Over the limit: close the oldest streams (never the one just opened).
    for (const existing of userConnections) {
      if (userConnections.size <= MAX_STREAMS_PER_USER) {
        break;
      }
      this.close(userId, existing);
    }

    const stream = new Observable<RealtimeMessage>((subscriber) => {
      const subscription = subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        this.remove(userId, subject);
      };
    });
    return { stream, close: () => this.close(userId, subject) };
  }

  // `data` must be JSON-serializable; it is encoded once per call.
  sendToUser(userId: string, event: string, data: object): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return;
    }
    const message = toMessage(event, data);
    for (const subject of userConnections) {
      subject.next(message);
    }
  }

  broadcast(event: string, data: object, options: BroadcastOptions = {}): void {
    const message = toMessage(event, data);
    for (const [userId, userConnections] of this.connections) {
      if (userId === options.exceptUserId) {
        continue;
      }
      for (const subject of userConnections) {
        subject.next(message);
      }
    }
  }

  // Users with at least one open stream.
  connectedUserIds(): string[] {
    return [...this.connections.keys()];
  }

  private close(userId: string, subject: Subject<RealtimeMessage>): void {
    if (this.remove(userId, subject)) {
      subject.complete();
    }
  }

  // Returns whether the connection was still registered.
  private remove(userId: string, subject: Subject<RealtimeMessage>): boolean {
    const userConnections = this.connections.get(userId);
    if (!userConnections?.delete(subject)) {
      return false;
    }
    if (userConnections.size === 0) {
      this.connections.delete(userId);
    }
    return true;
  }
}

// `data` is sent pre-encoded (a string) so the response serializer passes it
// through verbatim; on the wire it is the same `data: {json}` line.
function toMessage(event: string, data: object): RealtimeMessage {
  return { type: event, data: JSON.stringify(data) };
}
