import { vi } from 'vitest'

function mockStorageArea() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  }
}

function mockEvent() {
  return {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
    hasListeners: vi.fn(),
  }
}

const chrome = {
  action: {
    onClicked: mockEvent(),
  },
  storage: {
    local: mockStorageArea(),
    session: mockStorageArea(),
    sync: mockStorageArea(),
    onChanged: mockEvent(),
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
    update: vi.fn(),
    query: vi.fn(),
    onRemoved: mockEvent(),
  },
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    getManifest: vi.fn(() => ({ version: '0.1.1' })),
    getPlatformInfo: vi.fn(cb => cb({ os: 'mac', arch: 'arm', nacl_arch: 'arm' })),
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    openOptionsPage: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: mockEvent(),
    onMessageExternal: mockEvent(),
    onInstalled: mockEvent(),
    lastError: undefined,
  },
  i18n: {
    getUILanguage: vi.fn(() => 'en-US'),
  },
}

Object.assign(globalThis, { chrome })
