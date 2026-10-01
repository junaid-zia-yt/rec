/**
 * Auth/authorization error types. Messages are intentionally generic —
 * "Never expose whether an email account exists" and "safe generic
 * authentication errors" (Build Phase 2 brief §2/§SECURITY) apply to every
 * error surfaced to a client, not just the sign-in form specifically.
 */
export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Sign in required.')
    this.name = 'AuthenticationRequiredError'
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super('You do not have access to this organization.')
    this.name = 'NotAMemberError'
  }
}

export class InsufficientRoleError extends Error {
  constructor() {
    super('You do not have permission to perform this action.')
    this.name = 'InsufficientRoleError'
  }
}

export class CrossTenantAccessError extends Error {
  constructor() {
    super('That resource could not be found.')
    this.name = 'CrossTenantAccessError'
  }
}

/**
 * Generic message shown for any sign-in failure (wrong password, unknown
 * email, unconfirmed email, revoked membership) — never differentiated, so
 * the response itself cannot be used to enumerate valid accounts.
 */
export const GENERIC_AUTH_ERROR_MESSAGE = 'Incorrect email or password.'

/** Shown for password-reset requests, regardless of whether the email exists. */
export const GENERIC_RESET_REQUESTED_MESSAGE =
  "If an account exists for that email, we've sent a password reset link."
