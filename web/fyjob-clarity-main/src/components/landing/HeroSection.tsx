import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink, Globe, Lock, Terminal } from "lucide-react";
import { motion } from "framer-motion";
import { FyjobLogo } from "@/components/FyjobLogo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const HeroSection = ({ t }: { t: any }) => {
  return (
    <section className="relative overflow-hidden min-h-[68vh] sm:min-h-[72vh] flex items-center">
       {/* Background Grid */}
      <div className="absolute inset-x-0 bottom-0 h-[300px] w-full bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,#000_70%,transparent_100%)] opacity-20" />
      <div className="absolute -top-36 right-[-8rem] sm:right-[-4rem] h-72 w-72 sm:h-96 sm:w-96 rounded-full bg-primary/15 blur-3xl" />

      <div className="container relative z-20 mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-10 sm:pb-16 text-center">
         <motion.div 
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 0.5 }}
           className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] sm:text-xs font-semibold mb-6 sm:mb-8 uppercase tracking-wider"
         >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            {t('hero_badge')}
         </motion.div>

         <motion.h1 
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 0.5, delay: 0.1 }}
           className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-foreground text-balance max-w-4xl mx-auto mb-6 sm:mb-8"
         >
           {t('hero_title')}
         </motion.h1>

         <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          className="text-sm sm:text-base md:text-lg text-muted-foreground text-balance max-w-2xl mx-auto leading-relaxed mb-8 sm:mb-10"
         >
            {t('hero_desc')}
         </motion.p>

         <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
         >
          <Link to="/auth" className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl shadow-glow transition-all text-sm group w-full sm:w-auto justify-center">
               <Terminal className="h-4 w-4" /> {t('hero_cta')}
               <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-center w-full sm:w-auto border border-border bg-card/70 hover:bg-card/90 backdrop-blur px-5 sm:px-6 py-3.5 sm:py-4 rounded-xl transition-colors"
                aria-label="Open FYJOB extension browser options"
              >
                <FyjobLogo compact iconClassName="h-4 w-4" wordmarkClassName="text-sm font-bold tracking-tight" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,340px)] border-border bg-card/95 backdrop-blur-xl p-3 sm:p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-foreground">Install FYJOB Scanner</p>
                <p className="text-xs text-muted-foreground">Choose your browser. Edge and Chrome are locked for now.</p>
              </div>

              <div className="space-y-2">
                <a
                  href="https://addons.mozilla.org/en-US/firefox/addon/fyjob/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-left transition-colors hover:bg-emerald-500/15"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <Globe className="h-4 w-4 text-emerald-400" /> Firefox
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                    Live <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                </a>

                <button
                  type="button"
                  disabled
                  className="w-full flex items-center justify-between rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5 text-left cursor-not-allowed opacity-70"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <Lock className="h-4 w-4 text-muted-foreground" /> Edge
                  </span>
                  <span className="text-[11px] text-muted-foreground">TBA</span>
                </button>

                <button
                  type="button"
                  disabled
                  className="w-full flex items-center justify-between rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5 text-left cursor-not-allowed opacity-70"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <Lock className="h-4 w-4 text-muted-foreground" /> Chrome
                  </span>
                  <span className="text-[11px] text-muted-foreground">TBA</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
         </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.38 }}
          className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="terminal-chip">CV Analyzer</span>
          <span className="terminal-chip">Interview Lite</span>
          <span className="terminal-chip">Killer Quiz</span>
        </motion.div>
      </div>
    </section>
  )
}
