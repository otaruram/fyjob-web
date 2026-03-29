import { Server, Database, Lock, Bot } from "lucide-react";

export const TechStack = ({ t }: { t: any }) => {
  const stack = [
    { title: 'Serverless Compute', value: 'Azure Functions backend', icon: Server },
    { title: 'Data Engine', value: 'Azure Cosmos DB NoSQL', icon: Database },
    { title: 'Enterprise Auth', value: 'Supabase JWT Architecture', icon: Lock },
    { title: 'AI Inference Engines', value: 'Claude Haiku & Gemini 2.5 Pro', icon: Bot },
  ];

  return (
    <section className="py-24">
      <div className="container mx-auto px-6 max-w-5xl text-center">
        <h2 className="text-sm font-semibold tracking-widest text-primary uppercase mb-3">{t('tech_title')}</h2>
        <p className="text-xl md:text-3xl font-bold tracking-tight text-foreground mb-16 max-w-2xl mx-auto leading-snug">
           {t('tech_desc')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
           {stack.map((item, idx) => (
             <div key={idx} className="glass border-border p-5 rounded-2xl hover:border-primary/40 transition-colors">
               <item.icon className="h-6 w-6 text-muted-foreground mb-4" />
               <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">{item.title}</h3>
               <p className="font-medium text-foreground text-sm leading-tight">{item.value}</p>
             </div>
           ))}
        </div>
      </div>
    </section>
  );
};
