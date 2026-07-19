import { describe, expect, it } from 'vitest';
import { objectTypeEnum, users } from './schema/index.js';

describe('db schema smoke', () => {
  it('exposes the users table', () => {
    expect(users).toBeDefined();
    // users.email is a notNull column
    expect(users.email.notNull).toBe(true);
  });

  it('has the object type enum with all variants', () => {
    expect(objectTypeEnum.enumValues).toEqual([
      'project',
      'research',
      'discovery',
      'decision',
      'opportunity',
      'learning_path',
      'note',
      'collection',
    ]);
  });
});
