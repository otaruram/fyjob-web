import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import MatchGauge from "@/components/MatchGauge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Target, Swords, ArrowRight, TrendingUp, Clock, Zap, Shield } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { getUserStats, UserStats } from "@/lib/api";
import { useNavigate } from "react-router-dom";

const anim = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

const getScoreColor = (score: number) => {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-primary";
  return "text-warning";
};

const Dashboard = () => {
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Engineer';

  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Only fetch when session is confirmed
    if (!session) return;
    
    const fetchStats = async () => {
      try {
        const data = await getUserStats();
        setStats(data);
      } catch (error) {
        console.error("Failed to fetch user stats", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [session]);

  const topJob = stats?.recent_analyses?.[0];
  const isAdmin = stats?.role === 'admin';

  const metrics = [
    { label: "Analyses Done", value: stats?.total_analyses || 0, icon: BarChart3, highlight: false },
    { label: "Avg Match Score", value: `${stats?.avg_match_score || 0}%`, icon: Target, highlight: false },
    { 
      label: isAdmin ? "Admin Credits" : "Daily Credits", 
      value: isAdmin ? '∞' : `${stats?.credits_remaining || 0} / ${stats?.max_credits || 5}`, 
      icon: isAdmin ? Shield : Zap, 
      highlight: true 
    },
  ];

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
  <DashboardLayout>
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Welcome */}
      <motion.div {...anim(0)} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            {t('dash_welcome')}, {displayName}
            {isAdmin && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/30 text-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.15)]">
                <Shield className="w-3 h-3" />
                Admin
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            {t('dash_active_cv')}: 
            {stats?.cv_uploaded ? (
              <span className="text-primary font-medium flex items-center gap-1 cursor-pointer hover:underline" onClick={() => navigate('/cv-manager')}>
                {stats.cv_filename}
              </span>
            ) : (
              <span className="text-warning text-xs cursor-pointer hover:underline" onClick={() => navigate('/cv-manager')}>
                No CV Uploaded
              </span>
            )}
          </p>
        </div>
        
        {/* Next Regen Timer Info */}
        {stats?.next_regen_time && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-800">
            <Clock className="w-3.5 h-3.5" />
            <span>Next credit regen (+1): </span>
            <span className="font-mono text-primary font-medium">
              {new Date(stats.next_regen_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </span>
            <span className="opacity-50"> ({stats.timezone})</span>
          </div>
        )}
      </motion.div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {metrics.map((m, i) => (
          <motion.div key={m.label} {...anim(0.1 + i * 0.05)} className={`glass rounded-xl p-5 ${m.highlight ? (isAdmin ? 'border-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.1)]' : 'border-primary/50') : 'gradient-border'}`}>
            <div className="flex items-center justify-between mb-3">
              <m.icon className={`h-5 w-5 ${m.highlight ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className={`text-2xl font-bold ${m.highlight ? (isAdmin ? 'text-violet-400' : 'text-primary') : 'text-foreground'}`}>{m.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Job Spotlight */}
        <motion.div {...anim(0.3)} className="lg:col-span-2 glass rounded-xl p-6 gradient-border">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Latest Job Scan
          </h2>
          {topJob ? (
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-foreground">{topJob.jobTitle}</h3>
                <p className="text-muted-foreground text-sm mt-1 mb-4">{topJob.portal}</p>
                <div className="flex gap-2">
                  <Button variant={topJob.has_learning_path ? "outline" : "hero"} size="sm" onClick={() => navigate('/study-room')}>
                    {topJob.has_learning_path ? 'View Study Path' : 'Generate Study Path'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigate('/killer-quiz')}>
                    {topJob.has_quiz ? 'Take Quiz' : 'Generate Quiz'}
                  </Button>
                </div>
              </div>
              <div className="shrink-0">
                <MatchGauge score={topJob.score} size={120} strokeWidth={8} />
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-muted-foreground mb-4">You haven't analyzed any jobs yet.</p>
              <Button variant="hero" onClick={() => window.open('https://linkedin.com/jobs', '_blank')}>
                Scan Jobs with Extension
              </Button>
            </div>
          )}
        </motion.div>

        {/* Skill Gaps */}
        <motion.div {...anim(0.35)} className="glass rounded-xl p-6 gradient-border">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Common Skill Gaps
          </h2>
          {stats?.skill_gaps?.length ? (
            <div className="flex flex-wrap gap-2">
              {stats.skill_gaps.map((gap, i) => (
                <Badge key={i} variant="outline" className="border-warning/40 bg-warning/10 text-warning text-xs font-medium">
                  {gap.name} <span className="opacity-50 ml-1">x{gap.frequency}</span>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No gaps identified yet. Run more analyses!</p>
          )}
        </motion.div>
      </div>

      {/* Recent Applications */}
      <motion.div {...anim(0.4)} className="glass rounded-xl p-6 gradient-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Analysis History
        </h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Job Title</TableHead>
                <TableHead className="text-muted-foreground">Portal</TableHead>
                <TableHead className="text-muted-foreground">Match</TableHead>
                <TableHead className="text-muted-foreground">Date</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats?.recent_analyses?.map((app) => (
                <TableRow key={app.id} className="border-border hover:bg-muted/30">
                  <TableCell className="font-medium text-foreground">{app.jobTitle}</TableCell>
                  <TableCell className="text-muted-foreground">{app.portal}</TableCell>
                  <TableCell>
                    <span className={`font-mono font-semibold ${getScoreColor(app.score)}`}>
                      {app.score}%
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(app.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/application-history')}>View Details</Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!stats?.recent_analyses || stats.recent_analyses.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    No history found. Try analyzing a job first.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </motion.div>
    </div>
  </DashboardLayout>
  );
};

export default Dashboard;
