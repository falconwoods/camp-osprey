import { vi } from 'vitest'

const mockStorageArea = () => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
})

const mockEvent = () => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  hasListener: vi.fn(),
  hasListeners: vi.fn(),
})

const chrome = {
  storage: {
    local: mockStorageArea(),
    session: mockStorageArea(),
    sync: mockStorageArea(),
  },
  cookies: {
    get: vi.fn(),
    getAll: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    onChanged: mockEvent(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    onAlarm: mockEvent(),
  },
  notifications: {
    create: vi.fn(),
    clear: vi.fn(),
    onClicked: mockEvent(),
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(),
  },
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    getManifest: vi.fn(() => ({ version: '0.1.0' })),
    getPlatformInfo: vi.fn(cb => cb({ os: 'mac', arch: 'arm', nacl_arch: 'arm' })),
    getURL: vi.fn((path: string) => path),
    openOptionsPage: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: mockEvent(),
    onMessageExternal: mockEvent(),
    onInstalled: mockEvent(),
  },
}

Object.assign(global, { chrome })
