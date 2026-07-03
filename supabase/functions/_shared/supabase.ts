import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Client scoped to the caller's JWT — obeys RLS as that user. */
export function userClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Privileged client — bypasses RLS. Used to write secret token columns. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the authenticated user from the request's bearer token. */
export async function getUser(req: Request) {
  const supabase = userClient(req);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** Fetch the stored access token/API key for a user's connector (service role). */
export async function getConnectorToken(
  userId: string,
  provider: string
): Promise<string | null> {
  const admin = serviceClient();
  const { data } = await admin
    .from('connector_credentials')
    .select('access_token')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  return data?.access_token ?? null;
}
