import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
// Index landing page is not used — all visitors must authenticate first
import Auth from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import CVManager from "./pages/CVManager.tsx";
import ApplicationHistory from "./pages/ApplicationHistory.tsx";
import StudyRoom from "./pages/StudyRoom.tsx";
import KillerQuiz from "./pages/KillerQuiz.tsx";
import Settings from "./pages/Settings.tsx";
import Alerts from "./pages/Alerts.tsx";
import Encryption from "./pages/Encryption.tsx";
// NotFound page removed — unknown routes redirect to /auth
import { TranslationProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const queryClient = new QueryClient();

/**
 * AuthCallbackGuard:
 * When the URL contains #access_token (OAuth redirect), Supabase needs time
 * to process the hash. Show a loading state until onAuthStateChange fires
 * and the hash is consumed. This prevents ProtectedRoute from redirecting
 * to /auth prematurely.
 */
const AuthCallbackGuard = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { loading } = useAuth();

  // Detect OAuth hash fragment in the URL
  const hasOAuthHash = location.hash.includes("access_token");

  if (hasOAuthHash && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="text-sm text-muted-foreground animate-pulse">Authenticating...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

// Protected Route Wrapper
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><span className="animate-pulse">Loading Identity...</span></div>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
};

// Route that redirects to Dashboard if already logged in (like the Auth page itself)
const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();
  
  if (loading) return null;
  
  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

/**
 * RootRedirect:
 * "/" always redirects — to /dashboard if logged in, to /auth if not.
 * This ensures no one can browse any page without authentication.
 */
const RootRedirect = () => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="text-sm text-muted-foreground animate-pulse">Loading...</span>
        </div>
      </div>
    );
  }

  return session ? <Navigate to="/dashboard" replace /> : <Navigate to="/auth" replace />;
};

const App = () => (
  <TranslationProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthCallbackGuard>
              <Routes>
                {/* Root always redirects based on auth state */}
                <Route path="/" element={<RootRedirect />} />
                <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
                
                {/* ALL features require authentication */}
                <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/dashboard/cv" element={<ProtectedRoute><CVManager /></ProtectedRoute>} />
                <Route path="/dashboard/applications" element={<ProtectedRoute><ApplicationHistory /></ProtectedRoute>} />
                <Route path="/dashboard/study" element={<ProtectedRoute><StudyRoom /></ProtectedRoute>} />
                <Route path="/dashboard/quiz" element={<ProtectedRoute><KillerQuiz /></ProtectedRoute>} />
                <Route path="/dashboard/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/dashboard/settings/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
                <Route path="/dashboard/settings/encryption" element={<ProtectedRoute><Encryption /></ProtectedRoute>} />
                
                {/* Any unknown route → force to auth */}
                <Route path="*" element={<Navigate to="/auth" replace />} />
              </Routes>
            </AuthCallbackGuard>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  </TranslationProvider>
);

export default App;
