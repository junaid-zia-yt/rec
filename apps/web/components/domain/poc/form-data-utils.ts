/**
 * Uncontrolled forms built via `new FormData(formEl)` (rather than field-by-
 * field controlled `fd.set(...)` calls, the convention
 * outreach-sequence-workspace.tsx uses) submit every named input even when
 * left blank, as an empty string. A Zod `.optional()` field only skips
 * validation when the key is `undefined` — an empty string still hits
 * `.uuid()` (fails) or `z.coerce.number()` (silently becomes `0`, not
 * "not provided"). This strips blank string values before an action call
 * so a left-blank optional field is genuinely absent, not a corrupted 0/"".
 */
export function stripEmptyFormFields(fd: FormData): FormData {
  for (const key of [...fd.keys()]) {
    const value = fd.get(key)
    if (typeof value === 'string' && value.trim() === '') fd.delete(key)
  }
  return fd
}
