import { Link } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";
import { motion } from "framer-motion";

export const HeroSection = ({ t }: { t: any }) => {
  return (
    <section className="relative overflow-hidden min-h-[70vh] flex items-center">
       {/* Background Grid */}
      <div className="absolute inset-x-0 bottom-0 h-[300px] w-full bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,#000_70%,transparent_100%)] opacity-20" />

      <div className="container relative z-20 mx-auto px-6 pt-20 pb-16 text-center">
         <motion.div 
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 0.5 }}
           className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold mb-8 uppercase tracking-wider"
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
           className="text-5xl md:text-7xl font-bold tracking-tighter text-foreground text-balance max-w-4xl mx-auto mb-8"
         >
           {t('hero_title')}
         </motion.h1>

         <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-muted-foreground text-balance max-w-2xl mx-auto leading-relaxed mb-10"
         >
            {t('hero_desc')}
         </motion.p>

         <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
         >
            <Link to="/auth" className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8 py-4 rounded-xl shadow-glow transition-all text-sm group w-full sm:w-auto justify-center">
               <Terminal className="h-4 w-4" /> {t('hero_cta')}
               <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a href="https://github.com" target="_blank" className="flex items-center gap-2 border border-border bg-card/50 hover:bg-card hover:border-primary/50 text-foreground font-semibold px-8 py-4 rounded-xl transition-all text-sm w-full sm:w-auto justify-center">
               {t('hero_github')}
            </a>
         </motion.div>
      </div>
    </section>
  )
}
