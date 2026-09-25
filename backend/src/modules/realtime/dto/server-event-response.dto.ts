import { Expose } from 'class-transformer';

// One message on the GET /events stream (Nest's MessageEvent). `type` is the
// SSE `event:` name and `data` the already JSON-encoded body; a heartbeat
// carries only `comment` (written as `: ping`). Declared so the global
// ResponseSerializerInterceptor, which runs on every emitted message, lets
// these fields through.
export class ServerEventResponseDto {
  @Expose()
  type?: string;

  @Expose()
  data?: string;

  @Expose()
  comment?: string;
}
