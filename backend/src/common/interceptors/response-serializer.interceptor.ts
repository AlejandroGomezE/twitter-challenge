import {
  type ClassSerializerContextOptions,
  ClassSerializerInterceptor,
  Injectable,
  InternalServerErrorException,
  type PlainLiteralObject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// Fail-closed response whitelist. Every handler that returns a body must
// declare its response DTO with @SerializeOptions({ type: XResponseDto });
// the body is then converted to that class and only its @Expose()d fields
// are emitted. A body without a declared type (even a DTO instance) is a
// 500 instead of being passed through unfiltered, which is what the stock
// ClassSerializerInterceptor does. undefined/null bodies (e.g. 204) pass.
@Injectable()
export class ResponseSerializerInterceptor extends ClassSerializerInterceptor {
  constructor(reflector: Reflector) {
    super(reflector, { excludeExtraneousValues: true });
  }

  override serialize(
    response: PlainLiteralObject | PlainLiteralObject[] | null | undefined,
    options: ClassSerializerContextOptions,
  ): PlainLiteralObject | PlainLiteralObject[] {
    if (response === undefined || response === null) {
      return response as unknown as PlainLiteralObject;
    }
    // `options` merges the defaults with the handler/class
    // @SerializeOptions() metadata, so `type` is set only when declared.
    if (!options.type) {
      throw new InternalServerErrorException();
    }
    return super.serialize(response, options);
  }
}
