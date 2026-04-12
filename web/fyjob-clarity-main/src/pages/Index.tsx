import { Link } from "react-router-dom";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { FyjobLogo } from "@/components/FyjobLogo";
import { HeroSection } from "@/components/landing/HeroSection";
import { Ecosystem } from "@/components/landing/Ecosystem";
import { Features } from "@/components/landing/Features";
import { Pricing } from "@/components/landing/Pricing";
import { TechStack } from "@/components/landing/TechStack";

const Index = () => {
  const { t } = useTranslation();
  const { session } = useAuth();
  const isLoggedIn = Boolean(session);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 glass-strong">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link to="/" aria-label="FYJOB home">
            <FyjobLogo />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              {isLoggedIn ? (
                <>
                  <Link to="/dashboard" className="hidden sm:inline-flex text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
                    Dashboard
                  </Link>
                  <Link
                    to="/dashboard"
                    className="text-xs sm:text-sm font-bold bg-primary text-primary-foreground px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-lg hover:shadow-glow transition-all whitespace-nowrap"
                  >
                    Go to Dashboard
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/auth"
                    className="text-xs sm:text-sm font-bold bg-primary text-primary-foreground px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-lg hover:shadow-glow transition-all whitespace-nowrap"
                  >
                    {t('nav_getstarted')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Blocks */}
      <main className="pt-20 sm:pt-24 pb-10 sm:pb-12">
         <HeroSection t={t} />
         <Features t={t} />
        <Pricing />
         <Ecosystem t={t} />
         <TechStack t={t} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-10 sm:py-12 bg-background/50">
        <div className="container mx-auto px-4 sm:px-6 text-center text-xs sm:text-sm text-muted-foreground">
          © 2026 FYJOB. The unfair advantage for hyper-competitive engineering roles.
        </div>
      </footer>
    </div>
  );
};

export default Index;
