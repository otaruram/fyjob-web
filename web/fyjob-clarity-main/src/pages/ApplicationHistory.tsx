import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart3, Target, AlertTriangle, Search, CheckCircle2, Swords, BookOpen, Clock, Bot, ExternalLink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getAnalysisHistory, getUserStats, UserStats } from "@/lib/api";
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

const getScoreDot = (score: number) => {
  if (score >= 80) return "bg-success";
  if (score >= 60) return "bg-primary";
  return "bg-warning";
};

type HistoryItem = {
  id: string;
  jobTitle: string;
  portal: string;
  matchScore: number;
  created_at: string;
  gaps: string[];
  has_quiz: boolean;
  has_learning_path: boolean;
};

const ApplicationHistory = () => {
  const [search, setSearch] = useState("");
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [stats, setStats] = useState<UserStats | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, historyData] = await Promise.all([
          getUserStats(),
          getAnalysisHistory(50, 0)
        ]);
        setStats(statsData);
        setHistory(historyData);
      } catch (error) {
        console.error("Failed to fetch history data", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const filtered = history.filter((app) => {
    const matchSearch =
      app.jobTitle?.toLowerCase().includes(search.toLowerCase()) ||
      app.portal?.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

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
        <motion.div {...anim(0)} className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analysis History</h1>
            <p className="text-sm text-muted-foreground mt-1">Review your past job matches and AI feedback</p>
          </div>
        </motion.div>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <motion.div {...anim(0.1)} className="glass rounded-xl p-5 gradient-border flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Scans</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{stats?.total_analyses || 0}</div>
            </div>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Search className="h-6 w-6 text-primary" />
            </div>
          </motion.div>

          <motion.div {...anim(0.15)} className="glass rounded-xl p-5 gradient-border flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Avg Match Score</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{stats?.avg_match_score || 0}%</div>
            </div>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
          </motion.div>

          <motion.div {...anim(0.2)} className="glass rounded-xl p-5 gradient-border">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Top Missing Skills</span>
            </div>
            {stats?.skill_gaps?.length ? (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {stats.skill_gaps.slice(0, 4).map((s) => (
                  <Badge key={s.name} variant="outline" className="border-warning/40 bg-warning/10 text-warning text-[10px] leading-tight py-0">
                    {s.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data yet.</p>
            )}
          </motion.div>
        </div>

        {/* Table */}
        <motion.div {...anim(0.3)} className="glass rounded-xl p-6 gradient-border">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Scan Records
            </h2>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search jobs or portals..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 w-full sm:w-64 bg-background/50"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground min-w-[200px]">Job Role & Portal</TableHead>
                  <TableHead className="text-muted-foreground">Match</TableHead>
                  <TableHead className="text-muted-foreground">Features Used</TableHead>
                  <TableHead className="text-muted-foreground">Date Scanned</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((app) => (
                  <TableRow key={app.id} className="border-border hover:bg-muted/30 group">
                    <TableCell>
                      <div>
                        <div className="font-medium text-foreground">{app.jobTitle}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          {app.portal} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getScoreDot(app.matchScore)}`} />
                        <span className={`font-mono font-semibold ${getScoreColor(app.matchScore)}`}>
                          {app.matchScore}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                       <div className="flex gap-2">
                          <Badge variant="outline" className={`border-primary/30 ${app.has_learning_path ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground opacity-50'} text-[10px] px-1.5 py-0 h-5`}>
                             <BookOpen className="w-3 h-3 mr-1" /> Path
                          </Badge>
                          <Badge variant="outline" className={`border-primary/30 ${app.has_quiz ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground opacity-50'} text-[10px] px-1.5 py-0 h-5`}>
                             <Swords className="w-3 h-3 mr-1" /> Quiz
                          </Badge>
                       </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(app.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                       <Button variant="ghost" size="sm" className="h-8 hover:text-primary" onClick={() => navigate('/ujang-chat')}>
                         <Bot className="w-4 h-4 mr-2 text-primary" /> Ask Ujang
                       </Button>
                    </TableCell>
                  </TableRow>
                ))}
                
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                      <div className="flex flex-col items-center justify-center">
                        <Search className="w-8 h-8 opacity-20 mb-3" />
                        <p>No scans found.</p>
                        <p className="text-xs opacity-70 mt-1">Use the FYJOB Extension to scan job postings directly.</p>
                      </div>
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

export default ApplicationHistory;
