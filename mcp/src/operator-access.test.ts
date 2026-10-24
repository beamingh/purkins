import { describe, expect, it } from 'vitest';
import { isApprovedMcpOwner } from './operator-access';

describe('MCP owner allowlist', () => {
  it('fails closed without a configured owner', () => {
    expect(isApprovedMcpOwner('owner@example.com', undefined)).toBe(false);
    expect(isApprovedMcpOwner('owner@example.com', '  ')).toBe(false);
  });
  it('rejects other valid Access identities', () => {
    expect(isApprovedMcpOwner('staff@example.com', 'owner@example.com')).toBe(false);
    expect(isApprovedMcpOwner('', 'owner@example.com')).toBe(false);
  });
  it('accepts only the configured email after normalization', () => {
    expect(isApprovedMcpOwner(' Owner@Example.com ', 'owner@example.com')).toBe(true);
  });
});
