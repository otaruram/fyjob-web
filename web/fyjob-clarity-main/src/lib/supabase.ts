import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Missing Supabase configuration. Make sure to set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.");
}

// Create a single supabase client for interacting with your database
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder_key',
  {
    auth: {
      detectSessionInUrl: true,      // Parse #access_token from OAuth redirects
      flowType: 'implicit',          // Use implicit flow (hash fragment)
      autoRefreshToken: true,        // Auto-refresh expired JWTs
      persistSession: true,          // Keep session in localStorage
      storageKey: `sb-${(supabaseUrl || '').split('//')[1]?.split('.')[0] || 'app'}-auth-token`,
    }
  }
);
