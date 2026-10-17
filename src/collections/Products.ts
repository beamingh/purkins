import type { CollectionConfig } from 'payload'
import { isOwner, isTeam } from '@/access/roles'

const ownerWrite = {
  update: ({ req }: { req: { user: unknown } }) => isOwner(req.user),
}

export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Inventory item', plural: 'Inventory' },
  admin: {
    group: 'Purkins',
    useAsTitle: 'title',
    defaultColumns: ['sku', 'title', 'quantity', 'suggestedPriceZMW', 'sellingPriceZMW', 'status'],
  },
  access: {
    read: ({ req }) => isTeam(req.user),
    create: ({ req }) => isOwner(req.user),
    // A partner can change only fields explicitly permitting it below.
    update: ({ req }) => isTeam(req.user),
    delete: ({ req }) => isOwner(req.user),
  },
  fields: [
    { name: 'title', type: 'text', label: 'Product name', required: true, access: ownerWrite },
    { name: 'sku', type: 'text', label: 'SKU', required: true, unique: true, access: ownerWrite },
    {
      name: 'category',
      type: 'select',
      options: [
        { label: 'Baby clothes', value: 'baby-clothes' },
        { label: 'Mum essentials', value: 'mum-essentials' },
        { label: 'Feeding', value: 'feeding' },
        { label: 'Bath and care', value: 'bath-care' },
        { label: 'Other', value: 'other' },
      ],
      access: ownerWrite,
    },
    { name: 'size', type: 'text', access: ownerWrite },
    { name: 'ageRange', type: 'text', label: 'Age range', access: ownerWrite },
    { name: 'colour', type: 'text', access: ownerWrite },
    { name: 'photos', type: 'relationship', relationTo: 'media', hasMany: true, access: ownerWrite },
    { name: 'stockLocation', type: 'text', label: 'Storage location (e.g. Sack A)', access: ownerWrite },
    { name: 'quantity', type: 'number', required: true, min: 0, defaultValue: 0, access: ownerWrite },
    {
      name: 'costPriceZMW',
      type: 'number',
      min: 0,
      label: 'Cost price (ZMW)',
      access: {
        read: ({ req }) => isOwner(req.user),
        create: ({ req }) => isOwner(req.user),
        update: ({ req }) => isOwner(req.user),
      },
    },
    {
      name: 'suggestedPriceZMW',
      type: 'number',
      min: 0,
      label: 'Suggested selling price (ZMW)',
      access: { update: ({ req }) => isTeam(req.user) },
    },
    {
      name: 'sellingPriceZMW',
      type: 'number',
      min: 0,
      label: 'Approved selling price (ZMW)',
      access: ownerWrite,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'intake',
      options: [
        { label: 'Inventory intake', value: 'intake' },
        { label: 'Needs pricing', value: 'needs-pricing' },
        { label: 'Ready to list', value: 'ready' },
        { label: 'Listed on Facebook', value: 'facebook-listed' },
        { label: 'Reserved', value: 'reserved' },
        { label: 'Sold', value: 'sold' },
      ],
      access: ownerWrite,
    },
    { name: 'notes', type: 'textarea', access: ownerWrite },
  ],
}
