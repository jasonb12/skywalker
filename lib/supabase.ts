import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Guard against missing Supabase config — create a real client only when URL is available.
// This prevents a fatal crash on app startup when env vars are not baked into the build.
let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.warn('[Supabase] Missing supabaseUrl or supabaseAnonKey — Supabase client is unavailable. Data fetching will fall back to local/cached data.');
  // Create a dummy proxy that won't crash but will return empty results
  supabase = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      if (prop === 'from') {
        return () => new Proxy({} as any, {
          get() {
            return () => Promise.resolve({ data: [], error: { message: 'Supabase not configured' } });
          },
        });
      }
      if (prop === 'auth') {
        return new Proxy({} as any, {
          get() {
            return () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } });
          },
        });
      }
      if (prop === 'rpc') {
        return () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } });
      }
      return () => {};
    },
  });
}

export { supabase };
