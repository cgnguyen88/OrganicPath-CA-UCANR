/** Matches the farms.name check constraint in the database. */
export const FARM_NAME_MAX = 120;

const FIELD_ORDER = ['name', 'email', 'password', 'farmName'];

/**
 * Interpret the result of supabase.auth.signUp. When email confirmation is on, Supabase
 * returns the new user but NO session until they click the emailed link, so they must not
 * be treated as signed in (every authenticated API call would fail).
 *
 * @param {{ user?: { email?: string } | null, session?: unknown } | null | undefined} data
 * @returns {{ kind: 'signed-in' } | { kind: 'confirm-email', email: string | undefined } | { kind: 'failed' }}
 */
export function interpretSignUp(data) {
  if (!data?.user) return { kind: 'failed' };
  return data.session ? { kind: 'signed-in' } : { kind: 'confirm-email', email: data.user.email };
}

/**
 * Validate the registration form and build the arguments for supabase.auth.signUp.
 * `name` and `farm_name` travel in the auth metadata; a database trigger reads
 * `farm_name` to create the farm and its owner membership.
 *
 * @param {{ name: string, email: string, password: string, farmName: string }} form
 * @returns {{ ok: true, payload: { email: string, password: string, options: { data: { name: string, farm_name: string } } } }
 *   | { ok: false, field: 'name' | 'email' | 'password' | 'farmName', code: 'required' | 'too_long' }}
 */
export function buildSignUpPayload(form) {
  const values = {
    name: form.name.trim(),
    email: form.email.trim(),
    password: form.password, // never trimmed: whitespace can be intentional
    farmName: form.farmName.trim(),
  };

  for (const field of FIELD_ORDER) {
    if (values[field].length === 0) return { ok: false, field, code: 'required' };
  }
  if (values.farmName.length > FARM_NAME_MAX) {
    return { ok: false, field: 'farmName', code: 'too_long' };
  }

  return {
    ok: true,
    payload: {
      email: values.email,
      password: values.password,
      options: { data: { name: values.name, farm_name: values.farmName } },
    },
  };
}
