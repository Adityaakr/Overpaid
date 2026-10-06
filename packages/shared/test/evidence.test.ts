import { describe, expect, it } from 'vitest';
import { canonicalJson, hashEvidence, parseStrictJson, canTransition } from '../src/index.js';

describe('evidence hashing', () => {
  const m = {
    task_id: 't1', merchant: 'Vistaflix', vigil_type: 'forgotten_subscription',
    steps: [{ url: 'http://x', action: 'navigate', timestamp: '2026-10-06T00:00:00Z', screenshot_sha256: null }],
    page_text_excerpts: ['Cancelled'], outcome: 'cancelled', confirmation_code: 'VF-1',
  };
  it('is key-order independent (RFC 8785)', () => {
    const reordered = { confirmation_code: 'VF-1', outcome: 'cancelled', ...m };
    expect(hashEvidence(reordered)).toBe(hashEvidence(m));
    expect(hashEvidence(m)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('canonicalises numbers and key order', () => {
    expect(canonicalJson({ b: 1, a: [2, 1.5] })).toBe('{"a":[2,1.5],"b":1}');
  });
  it('rejects duplicate keys', () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow(/duplicate/);
    expect(parseStrictJson('{"a":{"a":1},"b":[{"a":1},{"a":2}]}')).toBeTruthy();
  });
});

describe('task state machine', () => {
  it('allows the documented transitions only', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'needs_approval')).toBe(true);
    expect(canTransition('done', 'running')).toBe(false);
  });
});
