import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createCategoryCommand, updateCategoryCommand, CategoryValidationError } from './commands';
import { createCategory, getCategory, getCategoryByPublicId, updateCategory, descendantIds } from './db';
import { uniqueCategorySlug } from './slug';

vi.mock('./db', () => ({
  createCategory: vi.fn(), getCategory: vi.fn(), getCategoryByPublicId: vi.fn(),
  updateCategory: vi.fn(), deleteCategory: vi.fn(), descendantIds: vi.fn(),
}));
vi.mock('./slug', () => ({ uniqueCategorySlug: vi.fn() }));

const db = {} as D1Database;
const ROOT = 'cat_aaaaaaaaaa';
const CHILD = 'cat_bbbbbbbbbb';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(uniqueCategorySlug).mockResolvedValue('baby-clothes');
  vi.mocked(createCategory).mockResolvedValue(42);
  vi.mocked(getCategory).mockResolvedValue({
    id: 42, public_id: ROOT, parent_id: null, name: 'Baby clothes',
    slug: 'baby-clothes', created_at: '2026-10-24',
  });
  vi.mocked(getCategoryByPublicId).mockImplementation(async (_, publicId) => {
    if (publicId === ROOT) return {
      id: 42, public_id: ROOT, parent_id: null, name: 'Baby clothes',
      slug: 'baby-clothes', created_at: '2026-10-24',
    };
    if (publicId === CHILD) return {
      id: 43, public_id: CHILD, parent_id: 42, name: 'Bodysuits',
      slug: 'bodysuits', created_at: '2026-10-24',
    };
    return null;
  });
  vi.mocked(descendantIds).mockResolvedValue([42, 43]);
});

describe('shared category commands', () => {
  it('creates via the existing D1 domain function and returns a public ID', async () => {
    await expect(createCategoryCommand(db, {name:'Baby clothes'}))
      .resolves.toEqual({id: ROOT, slug:'baby-clothes'});
    expect(createCategory).toHaveBeenCalledWith(db, {
      name:'Baby clothes', slug:'baby-clothes', parent_id: null,
    });
  });

  it('rejects missing parents as input errors before writing', async () => {
    await expect(createCategoryCommand(db, {name:'Bodysuits', parent_id:'cat_cccccccccc'}))
      .rejects.toBeInstanceOf(CategoryValidationError);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('rejects category cycles without writing', async () => {
    await expect(updateCategoryCommand(db, ROOT, {name:'Baby clothes', parent_id: CHILD}))
      .rejects.toThrow('cannot be moved');
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('retains infrastructure error type instead of disguising DB failures as input errors', async () => {
    vi.mocked(createCategory).mockRejectedValueOnce(new Error('D1 unavailable'));
    await expect(createCategoryCommand(db, {name:'Baby clothes'}))
      .rejects.toThrow('D1 unavailable');
  });

  it('rejects malformed external category IDs', async () => {
    await expect(updateCategoryCommand(db, '42', {name:'Baby clothes'}))
      .rejects.toBeInstanceOf(CategoryValidationError);
    expect(updateCategory).not.toHaveBeenCalled();
  });
});
