import { Zap, BookOpen, FileText, Swords, MessageSquareWarning } from "lucide-react";

export const Features = ({ t }: { t: any }) => {
  const features = [
    { title: t('feat_quick_title'), desc: t('feat_quick_desc'), icon: Zap },
    { title: t('feat_ujang_title'), desc: t('feat_ujang_desc'), icon: MessageSquareWarning },
    { title: t('feat_study_title'), desc: t('feat_study_desc'), icon: BookOpen },
    { title: t('feat_quiz_title'), desc: t('feat_quiz_desc'), icon: Swords },
    { title: t('feat_cv_title'), desc: t('feat_cv_desc'), icon: FileText },
  ];

  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="text-center mb-16">
           <h2 className="text-3xl font-bold tracking-tight text-foreground mb-4">{t('feat_title')}</h2>
           <p className="text-muted-foreground">{t('feat_desc')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {features.map((feat, idx) => (
             <div key={idx} className="glass border-border p-6 rounded-2xl hover:bg-card/40 transition-all hover:scale-[1.02]">
                <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                   <feat.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{feat.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
             </div>
           ))}
        </div>
      </div>
    </section>
  );
};
