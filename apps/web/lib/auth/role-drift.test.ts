import { describe, expect, it } from 'vitest'
import { UserRole, ROLES } from '@rqi/types'

/**
 * packages/types/src/permissions.ts's `Role` type is a standalone literal
 * union (not derived from `UserRole`, to avoid a circular import — see that
 * file's comment). This test is what actually catches drift if the two
 * are ever edited independently: it fails the moment a role is added to
 * one but not the other, rather than relying on someone noticing in review.
 */
describe('Role / UserRole parity', () => {
  it('ROLES (permissions.ts) and UserRole (the Zod schema) enumerate exactly the same roles', () => {
    expect([...ROLES].sort()).toEqual([...UserRole.options].sort())
  })
})
