import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const apiSrcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(apiSrcDir, '../../..');
loadEnv({ path: resolve(repoRoot, '.env') });

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  loadEnv({ path: resolve(repoRoot, '.env.example') });
}

const app = await NestFactory.create(AppModule, {
  rawBody: true,
});

app.setGlobalPrefix('api');
app.enableCors({
  origin: process.env.WEB_ORIGIN ?? 'http://localhost:3200',
  credentials: true,
});
app.enableShutdownHooks();
app.useGlobalPipes(
  new ValidationPipe({
    forbidUnknownValues: true,
    transform: true,
    whitelist: true,
  }),
);

const port = Number.parseInt(process.env.API_PORT ?? '3201', 10);
await app.listen(port, '0.0.0.0');
