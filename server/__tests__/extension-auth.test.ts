import { describe, expect, it } from 'vitest';
import {
  normalizeExtensionEmail,
  normalizeExtensionName,
  normalizeExtensionCode,
  extensionAuthError,
} from '../lib/extension-auth';

describe('extension auth validation', () => {
  it('normalizes email by trimming and lowercasing', () => {
    expect(normalizeExtensionEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => normalizeExtensionEmail('not an email')).toThrow(extensionAuthError('invalid_email').message);
  });

  it('normalizes name by trimming repeated whitespace', () => {
    expect(normalizeExtensionName('  Eric   Smith  ')).toBe('Eric Smith');
  });

  it('rejects blank name', () => {
    expect(() => normalizeExtensionName('   ')).toThrow(extensionAuthError('name_required').message);
  });

  it('normalizes six digit code', () => {
    expect(normalizeExtensionCode(' 123456 ')).toBe('123456');
  });

  it('rejects malformed code', () => {
    expect(() => normalizeExtensionCode('12-456')).toThrow(extensionAuthError('invalid_code').message);
  });
});
