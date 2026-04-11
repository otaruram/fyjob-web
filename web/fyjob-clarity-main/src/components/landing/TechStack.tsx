import { Server, Database, Lock, Bot } from "lucide-react";
import { motion } from "framer-motion";

export const TechStack = ({ t }: { t: any }) => {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05,
      },
    },
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: "easeOut" },
    },
  };

  const stack = [
    { title: 'Serverless Compute', value: 'Azure Functions backend', icon: Server },
    { title: 'Data Engine', value: 'Azure Cosmos DB NoSQL', icon: Database },
    { title: 'Enterprise Auth', value: 'Supabase JWT Architecture', icon: Lock },
    { title: 'AI Inference Engines', value: ' Gemini 2.5 Flash', icon: Bot },
  ];

  return (
    <section className="py-24">
      <div className="container mx-auto px-6 max-w-5xl text-center">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="text-sm font-semibold tracking-widest text-primary uppercase mb-3"
        >
          {t('tech_title')}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.45, delay: 0.05, ease: "easeOut" }}
          className="text-xl md:text-3xl font-bold tracking-tight text-foreground mb-16 max-w-2xl mx-auto leading-snug"
        >
          {t('tech_desc')}
        </motion.p>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left"
        >
           {stack.map((tech, idx) => (
             <motion.div
               key={idx}
               variants={cardVariants}
               className="glass border-border p-5 rounded-2xl hover:border-primary/40 transition-colors"
             >
               <tech.icon className="h-6 w-6 text-muted-foreground mb-4" />
               <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">{tech.title}</h3>
               <p className="font-medium text-foreground text-sm leading-tight">{tech.value}</p>
             </motion.div>
           ))}
        </motion.div>
      </div>
    </section>
  );
};
