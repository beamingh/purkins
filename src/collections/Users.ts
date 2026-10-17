import type { CollectionConfig } from 'payload'
import { initialRoleFor, isOwner, isTeam } from '../access/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: true,
  access: {
    // Only the dedicated Payload first-user bootstrap may create the initial owner.
    // After that, only an owner can add accounts.
    create: ({ req }) => isOwner(req.user),
    read: ({ req }) =>
      isOwner(req.user)
        ? true
        : req.user && isTeam(req.user)
          ? { id: { equals: req.user.id } }
          : false,
    update: ({ req }) =>
      isOwner(req.user)
        ? true
        : req.user && isTeam(req.user)
          ? { id: { equals: req.user.id } }
          : false,
    delete: ({ req }) => isOwner(req.user),
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'owner',
      options: [
        { label: 'Owner', value: 'owner' },
        { label: 'Pricing partner', value: 'partner' },
      ],
      access: {
        update: ({ req }) => isOwner(req.user),
      },
      admin: { position: 'sidebar' },
    },
  ],
  hooks: {
    beforeChange: [
      ({ operation, req, data }) => {
        // Never trust a client-supplied role during account creation.
        // Payload's first-user endpoint alone can create the first owner.
        if (operation === 'create') {
          return { ...data, role: initialRoleFor(req.user) }
        }
        return data
      },
    ],
  },
  versions: false,
}
