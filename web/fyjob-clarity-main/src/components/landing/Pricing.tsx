import { Check, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

const plans = [
  {
    name: "Free",
    price: "Rp0",
    subtitle: "For starters",
    highlighted: false,
    features: [
      "Quick Match analysis",
      "Study Room basic path",
      "Killer Quiz generation",
      "CV manager core tools",
    ],
  },
  {
    name: "Basic",
    price: "Rp29k",
    subtitle: "Monthly",
    highlighted: false,
    features: [
      "Everything in Free",
      "Higher daily limits",
      "Interview Lite (text mode)",
      "Priority generation speed",
    ],
  },
  {
    name: "Pro",
    price: "Rp79k",
    subtitle: "Monthly",
    highlighted: true,
    features: [
      "Everything in Basic",
      "Interview Lite speech mode",
      "Deeper AI coaching quality",
      "Best queue priority",
    ],
  },
];

export const Pricing = () => {
  return (
    <section className="py-14 sm:py-18 lg:py-24 bg-background">
      <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="text-center mb-10 sm:mb-14"
        >
          <p className="terminal-kicker mb-3">pricing</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
            Pick Your Battle Plan
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Start free, upgrade when you need stronger interview coaching and higher throughput.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {plans.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className={
                plan.highlighted
                  ? "relative rounded-2xl border border-primary/40 bg-primary/5 p-5 sm:p-6 shadow-[0_0_30px_rgba(59,130,246,0.16)]"
                  : "rounded-2xl border border-border bg-card/70 p-5 sm:p-6"
              }
            >
              {plan.highlighted && (
                <div className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" /> Popular
                </div>
              )}

              <p className="text-sm font-semibold text-foreground">{plan.name}</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                <span className="text-xs text-muted-foreground mb-1">{plan.subtitle}</span>
              </div>

              <div className="mt-5 space-y-2.5">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-success/15 text-success">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-sm text-muted-foreground">{feature}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
