import { motion } from "framer-motion";
import MatchGauge from "@/components/MatchGauge";
import { Brain, Swords, GraduationCap, MessageCircle, Send } from "lucide-react";

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.12 },
  }),
};

const BentoGrid = () => (
  <section className="relative py-24">
    <div className="container mx-auto px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center mb-16"
      >
        <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
          Everything you need to <span className="gradient-text">land the role</span>
        </h2>
        <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
          From real-time job matching to brutal interview prep, FYJOB covers every angle.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 max-w-5xl mx-auto auto-rows-[220px]">
        {/* Card A - Wide */}
        <motion.div
          custom={0}
          variants={cardVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="md:col-span-2 glass rounded-2xl p-6 flex items-center gap-6 gradient-border group hover:border-primary/30 transition-colors"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold text-primary">Real-Time AI Match</span>
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Know where you stand — instantly</h3>
            <p className="text-sm text-muted-foreground">
              Get a FAANG-level match score for any job posting in seconds. No guesswork.
            </p>
          </div>
          <div className="shrink-0">
            <MatchGauge score={87} size={110} />
          </div>
        </motion.div>

        {/* Card B - Square */}
        <motion.div
          custom={1}
          variants={cardVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="glass rounded-2xl p-6 gradient-border hover:border-primary/30 transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <Swords className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Killer Quiz Arena</span>
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">5 MCQs + 5 Essays</h3>
          <p className="text-sm text-muted-foreground">
            AI-generated quizzes tailored to the exact job description.
          </p>
        </motion.div>

        {/* Card C - Square */}
        <motion.div
          custom={2}
          variants={cardVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="glass rounded-2xl p-6 gradient-border hover:border-primary/30 transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <GraduationCap className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Learning Paths</span>
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Structured Upskilling</h3>
          <p className="text-sm text-muted-foreground">
            Step-by-step roadmaps built from your exact skill gaps.
          </p>
        </motion.div>

        {/* Card D - Tall, spans 2 rows */}
        <motion.div
          custom={3}
          variants={cardVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="md:col-span-2 glass rounded-2xl p-6 gradient-border hover:border-primary/30 transition-colors flex flex-col"
        >
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Chat with Ujang</span>
          </div>
          <h3 className="text-lg font-bold text-foreground mb-3">Your brutally honest HR advisor</h3>
          <div className="flex-1 space-y-3 overflow-hidden">
            <div className="flex justify-end">
              <div className="bg-primary/15 text-foreground text-sm rounded-2xl rounded-br-md px-4 py-2 max-w-[80%]">
                Am I ready for this Senior PM role at Google?
              </div>
            </div>
            <div className="flex justify-start">
              <div className="bg-muted text-foreground text-sm rounded-2xl rounded-bl-md px-4 py-2 max-w-[80%]">
                Let me be real — your product metrics experience is thin. You need 6 months of focused A/B testing work. Here's your roadmap...
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-2.5">
            <span className="flex-1 text-sm text-muted-foreground">Ask Ujang anything...</span>
            <Send className="h-4 w-4 text-primary" />
          </div>
        </motion.div>

        {/* Card E - Wide stats */}
        <motion.div
          custom={4}
          variants={cardVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="md:col-span-2 glass rounded-2xl p-6 gradient-border hover:border-primary/30 transition-colors flex items-center justify-around"
        >
          {[
            { value: "50K+", label: "Jobs Analyzed" },
            { value: "92%", label: "Accuracy Rate" },
            { value: "4.9★", label: "User Rating" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  </section>
);

export default BentoGrid;
