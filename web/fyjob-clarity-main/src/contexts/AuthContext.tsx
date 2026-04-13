import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

const EXT_AUTH_BRIDGE_KEY = 'fyjob_auth_bridge_v1';
const EXT_AUTH_SYNC_EVENT = 'fyjob:auth-bridge-sync';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const notifyAuthBridgeSync = (state: 'signed_in' | 'signed_out') => {
    try {
      window.dispatchEvent(new CustomEvent(EXT_AUTH_SYNC_EVENT, { detail: { state, ts: Date.now() } }));
    } catch {
      // ignore bridge notification errors
    }
  };

  const syncExtensionBridge = (currentSession: Session | null) => {
    try {
      if (!currentSession?.access_token) {
        localStorage.removeItem(EXT_AUTH_BRIDGE_KEY);
        notifyAuthBridgeSync('signed_out');
        return;
      }

      localStorage.setItem(
        EXT_AUTH_BRIDGE_KEY,
        JSON.stringify({
          access_token: currentSession.access_token,
          refresh_token: currentSession.refresh_token || '',
          expires_at: currentSession.expires_at || null,
          email: currentSession.user?.email || '',
          ts: Date.now(),
        })
      );
      notifyAuthBridgeSync('signed_in');
    } catch {
      // ignore bridge failures
    }
  };

  useEffect(() => {
    // 1. Subscribe to auth state changes FIRST — this is the primary source.
    //    onAuthStateChange fires INITIAL_SESSION on mount (replaces manual getSession),
    //    and also fires SIGNED_IN when Supabase processes the OAuth #hash fragment.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        console.log('[FYJOB Auth]', event, currentSession?.user?.email ?? 'no-user');

        // Update state synchronously
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        syncExtensionBridge(currentSession);

        // Mark loading done on any auth event
        setLoading(false);
      }
    );

    // 2. Safety net: if onAuthStateChange never fires within 3s (shouldn't happen,
    //    but covers edge cases like blocked storage), force loading to false
    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          console.warn('[FYJOB Auth] Timeout — forcing loading=false');
        }
        return false;
      });
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    syncExtensionBridge(null);

    // Explicitly clear Supabase localStorage so the extension content script
    // detects the logout immediately (instead of waiting for 8s polling cycle)
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(k => {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {
      // Silently fail
    }

    // Force return to landing page after logout from any web UI entrypoint.
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.location.assign("/");
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
