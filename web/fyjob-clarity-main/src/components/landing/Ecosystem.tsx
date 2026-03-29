import { Server, Chrome, ArrowRightLeft } from "lucide-react";
import { motion } from "framer-motion";

export const Ecosystem = ({ t }: { t: any }) => {
  return (
    <section className="py-24 bg-card/30 border-y border-border relative overflow-hidden">
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-foreground mb-4">{t('eco_title')}</h2>
          <p className="text-muted-foreground">{t('eco_desc')}</p>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-center gap-6 lg:gap-12 max-w-5xl mx-auto">
           {/* The Analyzer - Extension */}
           <motion.div 
             initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once:true }}
             className="glass gradient-border p-8 rounded-2xl flex-1 w-full text-left"
           >
              <div className="h-16 w-16 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center mb-6">
                 <Chrome className="h-8 w-8 text-orange-500" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-3">{t('eco_ext_title')}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{t('eco_ext_desc')}</p>
           </motion.div>

           {/* Connector */}
           <div className="hidden md:flex flex-col items-center justify-center shrink-0 opacity-50">
             <ArrowRightLeft className="w-8 h-8 text-muted-foreground" />
             <div className="h-12 w-px bg-gradient-to-b from-transparent via-border to-transparent my-2" />
             <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">Data Sync</span>
           </div>

           {/* The Command Center - Web */}
           <motion.div 
             initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once:true }}
             className="glass gradient-border p-8 rounded-2xl flex-1 w-full text-left shadow-glow relative overflow-hidden"
           >
              {/* Subtle accent blob */}
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
              <div className="h-16 w-16 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-6 relative z-10">
                 <Server className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-3 relative z-10">{t('eco_web_title')}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed relative z-10">{t('eco_web_desc')}</p>
           </motion.div>
        </div>
      </div>
    </section>
  );
};
