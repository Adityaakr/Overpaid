import pino from 'pino';

export const logger = pino({
  name: 'fleet',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['*.headers', '*.authorization', '*.apiKey', '*.signedUrl', '*.cookie'], censor: '[redacted]' },
});
export type Logger = pino.Logger;
export const taskLogger = (taskId: string) => logger.child({ taskId });
