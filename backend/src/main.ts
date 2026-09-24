import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ObserveInstrument } from './observe.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
