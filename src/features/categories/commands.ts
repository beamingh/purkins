import type { D1Database } from '@cloudflare/workers-types';
import { createCategory, updateCategory, deleteCategory, descendantIds, getCategoryByPublicId, getCategory } from './db';
import { parseCategoryForm } from './form';
import { uniqueCategorySlug } from './slug';
import { parsePublicId } from '../ids/publicId';

export type CategoryCommand = {
  name: string;
  slug?: string;
  parent_id?: string | null;
};

function checked(data: CategoryCommand) {
  const form = new FormData();
  form.set('name', data.name);
  form.set('slug', data.slug ?? '');
  form.set('parent_id', data.parent_id ?? '');
  const parsed = parseCategoryForm(form);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.data;
}

async function parentRowId(db: D1Database, publicId: string | null): Promise<number | null> {
  if (!publicId) return null;
  const parent = await getCategoryByPublicId(db, publicId);
  if (!parent) throw new Error('That parent category no longer exists.');
  return parent.id;
}

/**
 * Shared Admin/operator domain commands. Deliberately NO implicit cache purge:
 * callers MUST arrange durable storefront invalidation after commit.
 * Do not expose from MCP until cross-Worker invalidation is implemented.
 */
export async function createCategoryCommand(db: D1Database, input: CategoryCommand) {
  const parsed = checked(input);
  const parent_id = await parentRowId(db, parsed.parentPublicId);
  const slug = await uniqueCategorySlug(db, parsed.slugInput || parsed.name);
  const id = await createCategory(db, { name: parsed.name, slug, parent_id });
  const row = await getCategory(db, id);
  if (!row?.public_id) throw new Error('Category public ID missing after insertion.');
  return { id: row.public_id, slug };
}

export async function updateCategoryCommand(db: D1Database, id: string, input: CategoryCommand) {
  const publicId = parsePublicId(id, 'category');
  if (!publicId) throw new Error('Pass a valid cat_ public ID.');
  const category = await getCategoryByPublicId(db, publicId);
  if (!category) throw new Error('Category not found.');
  const parsed = checked(input);
  const parent_id = await parentRowId(db, parsed.parentPublicId);
  if (parent_id != null && new Set(await descendantIds(db, category.id)).has(parent_id)) {
    throw new Error('A category cannot be moved under itself or one of its sub-categories.');
  }
  const slug = await uniqueCategorySlug(db, parsed.slugInput || parsed.name, category.id);
  await updateCategory(db, category.id, { name: parsed.name, slug, parent_id });
  return { id: publicId, slug };
}

export async function deleteCategoryCommand(db: D1Database, id: string) {
  const publicId = parsePublicId(id, 'category');
  if (!publicId) throw new Error('Pass a valid cat_ public ID.');
  const category = await getCategoryByPublicId(db, publicId);
  if (!category) throw new Error('Category not found.');
  await deleteCategory(db, category.id);
  return { deleted: publicId };
}
