import { describe, expect, it } from 'vitest';

import { resolvePort } from '../scripts/next-with-env.mjs';

describe('next-with-env port resolution', () => {
  it('uses PORT from the environment', () => {
    expect(resolvePort({ PORT: '4123' })).toBe('4123');
  });

  it('falls back to 3001 when PORT is not set', () => {
    expect(resolvePort({})).toBe('3001');
  });

  it('rejects invalid PORT values', () => {
    expect(() => resolvePort({ PORT: 'abc' })).toThrow('PORT must be a number between 1 and 65535');
    expect(() => resolvePort({ PORT: '70000' })).toThrow('PORT must be a number between 1 and 65535');
  });
});
