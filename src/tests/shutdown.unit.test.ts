import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../config/logger';
import { registerGracefulShutdown, type ShutdownSignalSource } from '../server/shutdown';

function logCapture() {
  const chunks: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  return { chunks, stream };
}

function signalHarness(): ShutdownSignalSource & { listeners: Partial<Record<NodeJS.Signals, () => void>> } {
  const listeners: Partial<Record<NodeJS.Signals, () => void>> = {};
  return { listeners, exitCode: undefined, once(signal, listener) { listeners[signal] = listener; } };
}

describe('graceful shutdown', () => {
  it('closes HTTP and disconnects Mongo once when a shutdown signal arrives', async () => {
    const output = logCapture();
    const logger = createLogger('info', output.stream as never);
    const signals = signalHarness();
    const disconnect = vi.fn(async () => undefined);
    let finishClose: (() => void) | undefined;
    let serverCloseCount = 0;
    const server = { close: (callback: (error?: Error) => void) => { serverCloseCount += 1; finishClose = () => callback(); } };

    registerGracefulShutdown(server, disconnect, logger, signals);
    signals.listeners.SIGTERM?.();
    signals.listeners.SIGINT?.();
    expect(serverCloseCount).toBe(1);
    finishClose?.();
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(output.chunks.join('')).toContain('Shutdown complete'));
    expect(output.chunks.join('')).toContain('Graceful shutdown started');
    expect(signals.exitCode).toBeUndefined();
  });

  it('returns a failing exit code if Mongo disconnect fails without logging error details', async () => {
    const output = logCapture();
    const logger = createLogger('error', output.stream as never);
    const signals = signalHarness();
    let finishClose: (() => void) | undefined;
    const server = { close: (_callback: (error?: Error) => void) => { finishClose = () => _callback(); } };
    registerGracefulShutdown(server, async () => { throw new Error('sensitive database detail'); }, logger, signals);
    signals.listeners.SIGINT?.();
    finishClose?.();
    await vi.waitFor(() => expect(signals.exitCode).toBe(1));
    const logs = output.chunks.join('');
    expect(logs).toContain('MongoDB shutdown failed');
    expect(logs).not.toContain('sensitive database detail');
  });
});
