import { Link } from "react-router-dom";
import { useTranslation } from "@/lib/i18n";
import { HeroSection } from "@/components/landing/HeroSection";
import { Ecosystem } from "@/components/landing/Ecosystem";
import { Features } from "@/components/landing/Features";
import { TechStack } from "@/components/landing/TechStack";

const Index = () => {
  const { language, toggleLanguage, t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 glass-strong">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">
            FY<span className="text-primary font-black">JOB</span>
          </Link>
          <div className="flex items-center gap-6">
            <button 
              onClick={toggleLanguage} 
              className="text-xs font-bold font-mono tracking-widest text-muted-foreground hover:text-foreground transition-colors uppercase border border-border px-2 py-1 rounded-md"
            >
              <span className={language === 'en' ? 'text-primary' : ''}>EN</span> / <span className={language === 'id' ? 'text-primary' : ''}>ID</span>
            </button>
            <div className="flex items-center gap-3">
              <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
                {t('nav_signin')}
              </Link>
              <Link
                to="/auth"
                className="text-sm font-bold bg-primary text-primary-foreground px-5 py-2.5 rounded-lg hover:shadow-glow transition-all"
              >
                {t('nav_getstarted')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Blocks */}
      <main className="pt-24 pb-12">
         <HeroSection t={t} />
         <Features t={t} />
         <Ecosystem t={t} />
         <TechStack t={t} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-12 bg-background/50">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          © 2026 FYJOB. The unfair advantage for hyper-competitive engineering roles.
        </div>
      </footer>
    </div>
  );
};

export default Index;
