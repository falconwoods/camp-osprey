import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterAcceptedExtensionLogs,
  getServerLogMinLevel,
  normalizeExtensionClientInfo,
  normalizeExtensionLogClientId,
  normalizeExtensionLogEntries,
  sendExtensionLogsToLoki,
} from '../lib/extension-logs';

describe('extension log ingestion helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('defaults the server minimum log level to info', () => {
    expect(getServerLogMinLevel()).toBe('info');
  });

  it('accepts a configured server minimum log level', () => {
    vi.stubEnv('EXTENSION_LOG_MIN_LEVEL', 'warning');
    expect(getServerLogMinLevel()).toBe('warning');
  });

  it('normalizes and filters extension log batches', () => {
    const entries = normalizeExtensionLogEntries({
      entries: [
        { ts: '2026-05-31T12:00:00.000Z', level: 'debug', event: 'debug_event', message: 'debug' },
        { ts: '2026-05-31T12:00:01.000Z', level: 'error', event: 'error_event', message: 'error' },
        { ts: 'bad-date', level: 'error', event: 'bad_event', message: 'bad' },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(filterAcceptedExtensionLogs(entries, 'warning')).toEqual([
      expect.objectContaining({ level: 'error', event: 'error_event' }),
    ]);
  });

  it('normalizes the extension client id from log batches', () => {
    expect(normalizeExtensionLogClientId({ clientId: 'client-1', entries: [] })).toBe('client-1');
    expect(normalizeExtensionLogClientId({ clientId: '', entries: [] })).toBeUndefined();
  });

  it('normalizes extension client info from log batches', () => {
    expect(normalizeExtensionClientInfo({
      clientInfo: {
        extensionVersion: '0.1.0',
        userAgent: 'Mozilla/5.0',
        platformOs: 'mac',
        platformArch: 'arm',
        platformNaclArch: 'arm',
        ignored: 'value',
      },
    })).toEqual({
      extensionVersion: '0.1.0',
      userAgent: 'Mozilla/5.0',
      platformOs: 'mac',
      platformArch: 'arm',
      platformNaclArch: 'arm',
    });
  });

  it('pushes accepted logs to Loki without auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));

    await sendExtensionLogsToLoki([{
      ts: '2026-05-31T12:00:00.000Z',
      level: 'error',
      event: 'trip_scan_error',
      message: 'Error scanning trip',
      tripId: 'trip-1',
    }], {
      userId: 'user-1',
      userEmail: 'user@example.com',
      clientId: 'client-1',
      ipAddress: '203.0.113.10',
      country: 'CA',
      clientInfo: { extensionVersion: '0.1.0', platformOs: 'mac', platformArch: 'arm' },
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3100/loki/api/v1/push',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.streams[0].stream).toEqual({
      service: 'campsoon',
      source: 'extension',
      level: 'error',
    });
    expect(body.streams[0].values[0][1]).toContain('"userId":"user-1"');
    expect(body.streams[0].values[0][1]).toContain('"clientId":"client-1"');
    expect(body.streams[0].values[0][1]).toContain('"ipAddress":"203.0.113.10"');
    expect(body.streams[0].values[0][1]).toContain('"country":"CA"');
    expect(body.streams[0].values[0][1]).toContain('"clientInfo"');
    expect(body.streams[0].values[0][1]).toContain('"platformOs":"mac"');
  });
});
