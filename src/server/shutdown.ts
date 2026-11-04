import type pino from 'pino';

export interface ShutdownSignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  exitCode?: NodeJS.Process['exitCode'] | undefined;
}

interface ClosableServer {
  close(callback: (error?: Error) => void): unknown;
}

export function registerGracefulShutdown(
  server: ClosableServer,
  disconnect: () => Promise<void>,
  logger: pino.Logger,
  signalSource: ShutdownSignalSource = process,
): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    server.close((error) => {
      if (error) logger.error({ err: error }, 'HTTP server shutdown failed');
      void disconnect().then(() => {
        if (error) signalSource.exitCode = 1;
        logger.info('Shutdown complete');
      }, (disconnectError: unknown) => {
        signalSource.exitCode = 1;
        logger.error({ errorClass: disconnectError instanceof Error ? disconnectError.constructor.name : 'UnknownError' }, 'MongoDB shutdown failed');
      });
    });
  };
  signalSource.once('SIGINT', () => shutdown('SIGINT'));
  signalSource.once('SIGTERM', () => shutdown('SIGTERM'));
}
