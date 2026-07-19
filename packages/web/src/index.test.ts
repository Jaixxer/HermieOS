import { describe, expect, it } from 'vitest';
import { hello } from './index.js';

describe('web placeholder', () => {
  it('returns a hello string', () => {
    expect(hello()).toBe('hermieos web placeholder');
  });
});
