import { describe, expect, it } from 'vitest';
import { requireVerifiedOwnerActorShape } from './ownerActor';

describe('MCP server-derived owner actor formats', () => {
  it('accepts authenticated legacy bearer and Access actors', () => {
    expect(requireVerifiedOwnerActorShape('owner:bearer')).toBe('owner:bearer');
    expect(requireVerifiedOwnerActorShape('owner:access:owner@example.com'))
      .toBe('owner:access:owner@example.com');
  });

  it('accepts hashed, owner-issued MCP client credential actors', () => {
    const actor = 'owner:client:8da8ea6f-6d5f-4391-8cce-21312f76ca01';
    expect(requireVerifiedOwnerActorShape(actor)).toBe(actor);
  });

  it.each([
    '',
    'owner:client:',
    'owner:client:12345',
    'owner:client:8da8ea6f-6d5f-1391-8cce-21312f76ca01',
    'owner:client:8da8ea6f-6d5f-4391-0cce-21312f76ca01',
    'owner:access:owner@example.com\nanything',
    'owner:access:anything',
    'buyer:client:8da8ea6f-6d5f-4391-8cce-21312f76ca01',
  ])('rejects unsupported or malformed actor %j', actor => {
    expect(() => requireVerifiedOwnerActorShape(actor))
      .toThrow('Verified owner identity is required.');
  });

  it('rejects oversized actor strings', () => {
    expect(() => requireVerifiedOwnerActorShape('owner:bearer'.repeat(40))).toThrow();
  });
});
