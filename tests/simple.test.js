/**
 * Simple smoke test to verify jest works
 */

import { describe, test, expect } from '@jest/globals';

describe('Simple Test', () => {
  test('1 + 1 = 2', () => {
    expect(1 + 1).toBe(2);
  });
});
