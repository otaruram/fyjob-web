import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

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
