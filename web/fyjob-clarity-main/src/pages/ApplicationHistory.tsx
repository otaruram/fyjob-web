import { useState, useEffect, Fragment } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BarChart3, Target, AlertTriangle, Search, CheckCircle2, Swords, BookOpen, Clock, Bot, ExternalLink, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getAnalysisHistory, getUserStats, UserStats, chatWithUjang, deleteAnalysisHistory } from "@/lib/api";
import { useNavigate } from "react-router-dom";

const sanitizeUjangText = (text: string) => {
  return (text || "")
    .replace(/[\*`_#>~\[\]\(\){}|]/g, "")
    .replace(/^[\s\-•]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

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

type SortBy = "date" | "name" | "portal";
type SortDir = "asc" | "desc";

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

type UjangCachePayload = Record<string, { text: string; savedAt: number }>;

const UJANG_CACHE_KEY = "fyjob_ujang_history_cache_v1";
const UJANG_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const readUjangCache = (): UjangCachePayload => {
  try {
    const raw = localStorage.getItem(UJANG_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UjangCachePayload;
    const now = Date.now();
    const filtered = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value?.text && now - Number(value.savedAt || 0) <= UJANG_CACHE_TTL_MS)
    );
    if (Object.keys(filtered).length !== Object.keys(parsed).length) {
      localStorage.setItem(UJANG_CACHE_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return {};
  }
};

const writeUjangCache = (next: UjangCachePayload) => {
  try {
    localStorage.setItem(UJANG_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/storage errors for optional cache
  }
};

const ApplicationHistory = () => {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [stats, setStats] = useState<UserStats | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ujangLoadingId, setUjangLoadingId] = useState<string | null>(null);
  const [ujangResponses, setUjangResponses] = useState<Record<string, string>>({});
  const [ujangErrors, setUjangErrors] = useState<Record<string, string>>({});
  const [previewItem, setPreviewItem] = useState<HistoryItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryItem | null>(null);

  useEffect(() => {
    const cache = readUjangCache();
    const hydrated = Object.fromEntries(Object.entries(cache).map(([id, value]) => [id, value.text]));
    setUjangResponses(hydrated);
  }, []);

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

  const filtered = history
    .filter((app) => {
      const q = search.toLowerCase();
      const dateLabel = new Date(app.created_at).toLocaleDateString().toLowerCase();
      const matchSearch =
        app.jobTitle?.toLowerCase().includes(q) ||
        app.portal?.toLowerCase().includes(q) ||
        dateLabel.includes(q);
      return matchSearch;
    })
    .sort((a, b) => {
      const aDate = new Date(a.created_at).getTime();
      const bDate = new Date(b.created_at).getTime();

      let cmp = 0;
      if (sortBy === "date") cmp = aDate - bDate;
      if (sortBy === "name") cmp = (a.jobTitle || "").localeCompare(b.jobTitle || "");
      if (sortBy === "portal") cmp = (a.portal || "").localeCompare(b.portal || "");

      return sortDir === "asc" ? cmp : -cmp;
    });

  const handleDeleteAnalysis = async (app: HistoryItem) => {
    try {
      setDeletingId(app.id);
      await deleteAnalysisHistory(app.id);

      setHistory((prev) => prev.filter((h) => h.id !== app.id));
      setExpandedId((prev) => (prev === app.id ? null : prev));
      setPreviewItem((prev) => (prev?.id === app.id ? null : prev));
      setUjangResponses((prev) => {
        const clone = { ...prev };
        delete clone[app.id];
        return clone;
      });
      setUjangErrors((prev) => {
        const clone = { ...prev };
        delete clone[app.id];
        return clone;
      });
      const cache = readUjangCache();
      delete cache[app.id];
      writeUjangCache(cache);
    } catch (error: any) {
      alert(error?.message || "Failed to delete analysis");
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  const handleAskUjang = async (app: HistoryItem) => {
    const isSameOpen = expandedId === app.id;
    if (isSameOpen && ujangResponses[app.id]) {
      setExpandedId(null);
      return;
    }

    setExpandedId(app.id);
    setUjangErrors((prev) => ({ ...prev, [app.id]: "" }));

    if (ujangResponses[app.id]) return;

    setUjangLoadingId(app.id);
    try {
      const result = await chatWithUjang(
        "Give a concise and practical analysis for this job based on my CV. Focus on current match, top 3 gaps, and top 3 next actions.",
        app.id,
        []
      );

      const clean = sanitizeUjangText(result?.response || "Analysis is not available.");
      setUjangResponses((prev) => ({ ...prev, [app.id]: clean }));
      const cache = readUjangCache();
      cache[app.id] = { text: clean, savedAt: Date.now() };
      writeUjangCache(cache);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch Ujang analysis.";
      setUjangErrors((prev) => ({ ...prev, [app.id]: msg }));
    } finally {
      setUjangLoadingId(null);
    }
  };

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
        <motion.div {...anim(0.3)} className="glass rounded-xl p-4 sm:p-6 gradient-border">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Scan Records
            </h2>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, portal, date..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 w-full sm:w-64 bg-background/50"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="h-9 rounded-md border border-border bg-background/50 px-3 text-sm"
                >
                  <option value="date">Sort: Date</option>
                  <option value="name">Sort: Name</option>
                  <option value="portal">Sort: Portal</option>
                </select>
                <select
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as SortDir)}
                  className="h-9 rounded-md border border-border bg-background/50 px-3 text-sm"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
            </div>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground min-w-[200px]">Job Role & Portal</TableHead>
                  <TableHead className="text-muted-foreground">Match</TableHead>
                  <TableHead className="text-muted-foreground">Date Scanned</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((app) => (
                  <Fragment key={app.id}>
                  <TableRow className="border-border hover:bg-muted/30 group">
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
                    <TableCell className="text-muted-foreground text-sm">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(app.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                       <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(app)}
                          disabled={deletingId === app.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => setPreviewItem(app)}
                        >
                          View Details
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => handleAskUjang(app)}
                          disabled={ujangLoadingId === app.id}
                        >
                          <Bot className="w-4 h-4 mr-2 text-primary" />
                          {ujangLoadingId === app.id ? "Analyzing..." : (ujangResponses[app.id] ? "Ask Ujang (Cached)" : "Ask Ujang")}
                        </Button>
                       </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === app.id && (
                    <TableRow className="border-border/60 bg-muted/20">
                      <TableCell colSpan={4} className="py-4">
                        <div className="rounded-lg border border-border bg-background/70 p-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs uppercase tracking-wider text-primary font-semibold">Ujang Analysis</p>
                            {ujangResponses[app.id] && <span className="text-[10px] text-muted-foreground">cached</span>}
                          </div>
                          {ujangLoadingId === app.id ? (
                            <p className="text-sm text-muted-foreground">Analyzing your job and CV...</p>
                          ) : ujangErrors[app.id] ? (
                            <p className="text-sm text-destructive">{ujangErrors[app.id]}</p>
                          ) : (
                            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                              {ujangResponses[app.id] || "No analysis available yet."}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                ))}
                
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
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

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((app) => (
              <div key={app.id} className="rounded-xl border border-border bg-background/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{app.jobTitle}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{app.portal}</p>
                  </div>
                  <button
                    onClick={() => setDeleteTarget(app)}
                    disabled={deletingId === app.id}
                    className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                    aria-label="Delete analysis"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${getScoreDot(app.matchScore)}`} />
                    <span className={`font-mono font-semibold ${getScoreColor(app.matchScore)}`}>
                      {app.matchScore}%
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(app.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge variant="outline" className={`border-primary/30 ${app.has_learning_path ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground opacity-50'} text-[10px] px-1.5 py-0 h-5`}>
                    <BookOpen className="w-3 h-3 mr-1" /> Path
                  </Badge>
                  <Badge variant="outline" className={`border-primary/30 ${app.has_quiz ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground opacity-50'} text-[10px] px-1.5 py-0 h-5`}>
                    <Swords className="w-3 h-3 mr-1" /> Quiz
                  </Badge>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => setPreviewItem(app)}>
                    View Details
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1"
                    onClick={() => handleAskUjang(app)}
                    disabled={ujangLoadingId === app.id}
                  >
                    <Bot className="w-4 h-4 mr-2 text-primary" />
                    {ujangLoadingId === app.id ? "Analyzing..." : (ujangResponses[app.id] ? "Ask Ujang (Cached)" : "Ask Ujang")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewItem(null)}>
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Preview</p>
                <h3 className="text-lg font-semibold text-foreground mt-1">{previewItem.jobTitle}</h3>
                <p className="text-sm text-muted-foreground mt-1">{previewItem.portal}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreviewItem(null)}>Close</Button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Match Score</p>
                <p className={`text-xl font-semibold mt-1 ${getScoreColor(previewItem.matchScore)}`}>{previewItem.matchScore}%</p>
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Date</p>
                <p className="text-sm font-medium mt-1 text-foreground">
                  {new Date(previewItem.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground mb-2">Top Gaps</p>
              <p className="text-sm text-foreground leading-relaxed">
                {previewItem.gaps?.length ? previewItem.gaps.slice(0, 3).join(". ") : "No critical gaps recorded."}
              </p>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus riwayat analisis?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Riwayat untuk \"${deleteTarget.jobTitle}\" akan dihapus permanen, termasuk quiz, learning path, Ujang chat, dan telemetry terkait.`
                : "Data analisis akan dihapus permanen."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  void handleDeleteAnalysis(deleteTarget);
                }
              }}
            >
              {deletingId && deleteTarget?.id === deletingId ? "Menghapus..." : "Hapus Permanen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default ApplicationHistory;
