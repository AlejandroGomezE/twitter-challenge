import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseSerializerInterceptor } from './common/interceptors/response-serializer.interceptor.js';

// App-level configuration shared by main.ts and the e2e suite, so e2e tests
// exercise the same middleware, pipes and filters as the running server.
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  app.use(helmet());
  // No secret: session tokens are random and verified server-side against a
  // stored hash, so cookie signing adds nothing.
  app.use(cookieParser());
  // Only the configured frontend origin may make credentialed requests. An
  // array (not a bare string) makes `cors` echo the origin only on an exact
  // match and omit Access-Control-Allow-Origin for any other origin.
  app.enableCors({
    origin: [configService.getOrThrow<string>('frontendOrigin')],
    credentials: true,
  });
  // No implicit conversion: request values keep the JSON type the client sent, so a number or
  // boolean in a string field fails @IsString() (400) instead of being silently coerced. DTO fields
  // that genuinely need conversion (e.g. numeric query params, which always arrive as strings)
  // declare it explicitly with @Type(() => Number).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  // Response whitelist (fails closed). Every handler that returns a body
  // declares its response DTO with @SerializeOptions({ type: XResponseDto })
  // and a matching concrete return type; only the DTO's @Expose()d fields are
  // emitted, so even a full Prisma row (passwordHash included) cannot leak.
  // A body without a declared type is a 500. 204 handlers return void and
  // need no DTO.
  app.useGlobalInterceptors(
    new ResponseSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
