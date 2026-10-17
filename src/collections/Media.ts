import type { CollectionConfig } from 'payload'
import { isOwner, isTeam } from '../access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: ({ req }) => isTeam(req.user),
    create: ({ req }) => isOwner(req.user),
    update: ({ req }) => isOwner(req.user),
    delete: ({ req }) => isOwner(req.user),
  },
  fields: [
    { name: 'alt', type: 'text', required: true },
  ],
  upload: {
    // Sharp cropping and focal-point processing aren't supported on Workers.
    crop: false,
    focalPoint: false,
  },
}
