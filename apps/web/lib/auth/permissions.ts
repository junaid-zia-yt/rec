import { hasPermission, type Action, type Resource } from '@rqi/types'
import { InsufficientRoleError } from './errors'
import type { Membership } from './membership'

export { hasPermission }
export type { Action, Resource }

/** Throws InsufficientRoleError unless `membership.role` has `action` on `resource` (docs/06-roles-permissions.md §6.2, transcribed in packages/types/src/permissions.ts). */
export function requirePermission(
  membership: Membership,
  resource: Resource,
  action: Action,
): void {
  if (!hasPermission(membership.role, resource, action)) {
    throw new InsufficientRoleError()
  }
}
