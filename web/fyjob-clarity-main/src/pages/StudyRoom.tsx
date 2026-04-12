import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Target, Clock, BookOpen, Video, FlaskConical, Search, ArrowRight, Zap, RefreshCw, ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getAnalysisHistory, generateLearningPath, LearningPath as LearningPathType } from "@/lib/api";
import { useNavigate } from "react-router-dom";

const anim = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

type AnalysisHistory = {
  id: string; jobTitle: string; portal: string;
  matchScore: number; created_at: string; gaps: string[];
  has_quiz: boolean; has_learning_path: boolean;
};

const resourceIcon = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes("article") || t.includes("book")) return <BookOpen className="h-3 w-3" />;
  if (t.includes("video") || t.includes("youtube")) return <Video className="h-3 w-3" />;
  return <FlaskConical className="h-3 w-3" />;
};

const StudyRoom = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisHistory | null>(null);
  const [learningPath, setLearningPath] = useState<LearningPathType | null>(null);
  const [loadedAnalysisId, setLoadedAnalysisId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchInit = async () => {
      try {
        const hist = await getAnalysisHistory(20, 0);
        setHistory(hist);
        
        // Find first analysis with learning path
        const firstWithPath = hist.find(h => h.has_learning_path);
        if (firstWithPath) {
           setSelectedAnalysis(firstWithPath);
           handleLoadPath(firstWithPath.id);
        } else if (hist.length > 0) {
           setSelectedAnalysis(hist[0]);
        }
      } catch (e: any) {
        console.error(e);
        setErrorMsg("Failed to load study room data");
      } finally {
        setIsLoadingHistory(false);
      }
    };
    fetchInit();
  }, []);

  const handleLoadPath = async (analysisId: string) => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      // If it exists on backend, it costs 0 credits. If it doesn't, it costs 1 credit.
      const res = await generateLearningPath(analysisId);
      setLearningPath(res.learning_path);
      setLoadedAnalysisId(analysisId);
      // Reset completed
      setCompleted(new Set());
      
      // Update local history stat to prevent double charge UI anxiety
      setHistory(prev => prev.map(h => h.id === analysisId ? { ...h, has_learning_path: true } : h));
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to load/generate learning path");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggle = (id: number) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const calculateProgress = () => {
    if (!learningPath || !learningPath.paths || learningPath.paths.length === 0) return 0;
    return Math.round((completed.size / learningPath.paths.length) * 100);
  };

  const progress = calculateProgress();

  if (isLoadingHistory) {
    return (
      <DashboardLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (history.length === 0) {
     return (
        <DashboardLayout>
          <div className="max-w-4xl mx-auto space-y-6">
             <h1 className="text-2xl font-bold text-foreground">{t('side_study')}</h1>
             <div className="glass rounded-xl p-12 text-center flex flex-col items-center">
                <Search className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <h2 className="text-xl font-semibold">No Job Scans Found</h2>
                <p className="text-muted-foreground mt-2 max-w-sm mb-6">
                   Analyze a job using the FYJOB Extension first to generate personalized study paths based on your skill gaps.
                </p>
                <Button variant="hero" onClick={() => window.open('https://linkedin.com/jobs')}>Find Jobs on LinkedIn</Button>
             </div>
          </div>
        </DashboardLayout>
     )
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-4 sm:gap-6">
        
        {/* Sidebar: Job Selector */}
        <div className="lg:w-[340px] shrink-0 flex flex-col gap-3 sm:gap-4">
           <motion.div {...anim(0)}>
             <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('side_study')}</h1>
             <p className="text-xs sm:text-sm text-muted-foreground mt-1">Select a job to view your path</p>
           </motion.div>
           
           <div className="flex flex-col gap-2 overflow-y-auto lg:max-h-[70vh] pr-1 sm:pr-2 custom-scrollbar">
              {history.map((h, i) => (
                 <motion.div 
                    {...anim(0.1 + (i * 0.05))} 
                    key={`${h.id}-${h.created_at}-${i}`}
                    onClick={() => {
                       setSelectedAnalysis(h);
                       if (h.has_learning_path && loadedAnalysisId !== h.id) {
                         handleLoadPath(h.id);
                       } else if (!h.has_learning_path) {
                         setLearningPath(null);
                         setLoadedAnalysisId(null);
                       }
                    }}
                      className={`p-3 sm:p-4 rounded-xl border cursor-pointer transition-all flex flex-col ${selectedAnalysis?.id === h.id ? 'bg-primary/10 border-primary ring-1 ring-primary/30' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}
                 >
                    <div className="flex justify-between items-start mb-1">
                        <span className={`font-semibold text-xs sm:text-sm truncate pr-2 ${selectedAnalysis?.id === h.id ? 'text-foreground' : ''}`}>{h.jobTitle}</span>
                        <span className="text-[10px] whitespace-nowrap opacity-60 mt-0.5">{new Date(h.created_at).toLocaleDateString()}</span>
                    </div>
                      <span className="text-[11px] sm:text-xs opacity-80 mb-3 truncate">{h.portal}</span>
                    <div className="flex items-center justify-between mt-auto">
                       {h.has_learning_path ? (
                          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30 px-1.5 py-0 h-5">Path Ready</Badge>
                       ) : (
                          <span className="text-[10px] opacity-60">No Path Generated</span>
                       )}
                       <ChevronRight className="w-4 h-4 opacity-40" />
                    </div>
                 </motion.div>
              ))}
           </div>
        </div>

        {/* Main Content: Path View */}
        <div className="flex-1 min-w-0">
           {errorMsg && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3 rounded-lg mb-4">
                 {errorMsg}
              </div>
           )}

           <AnimatePresence mode="wait">
              {selectedAnalysis && !learningPath && !isGenerating && (
                 <motion.div 
                    key="generate"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                      className="glass rounded-xl p-6 sm:p-10 flex flex-col items-center justify-center text-center min-h-[320px] sm:min-h-[50vh] gradient-border border-dashed border-2"
                 >
                    <BookOpen className="w-16 h-16 text-muted-foreground/50 mb-6" />
                      <h2 className="text-lg sm:text-xl font-bold mb-2">Generate Curriculum</h2>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mb-6">
                       AI will analyze the job requirements for <span className="text-foreground font-medium">{selectedAnalysis.jobTitle}</span> and generate exactly 3 practical learning paths to fix your skill gaps.
                    </p>
                    <Button variant="hero" onClick={() => handleLoadPath(selectedAnalysis.id)} disabled={isGenerating}>
                        <Zap className="w-4 h-4 mr-2" /> Generate Study Path (Free)
                    </Button>
                 </motion.div>
              )}

              {isGenerating && (
                 <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                      className="glass rounded-xl p-6 sm:p-10 flex flex-col items-center justify-center text-center min-h-[320px] sm:min-h-[50vh] gradient-border"
                 >
                    <RefreshCw className="w-12 h-12 text-primary animate-spin mb-4" />
                    <h2 className="text-lg font-semibold animate-pulse">Designing FAANG-level curriculum...</h2>
                    <p className="text-sm text-muted-foreground mt-2">Crawling course directories and structuring gaps.</p>
                 </motion.div>
              )}

              {learningPath && !isGenerating && (
                 <motion.div 
                    key="path"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-6"
                 >
                    {/* Spotlight */}
                    <div className="glass rounded-xl p-4 sm:p-6 gradient-border">
                      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Current Learning Path
                      </h2>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mt-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Target className="h-5 w-5 text-primary" />
                            <h3 className="text-base sm:text-lg font-bold text-foreground">{selectedAnalysis?.jobTitle}</h3>
                          </div>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Est. Completion: {learningPath.total_hours} Hours</p>
                          {progress >= 100 && (
                            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
                              <Zap className="h-3.5 w-3.5" />
                              Learning path completed. Nice work, keep the momentum.
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xl sm:text-2xl font-bold text-foreground">{progress}%</span>
                        </div>
                      </div>
                      <Progress value={progress} className="mt-4 h-2" />
                    </div>

                    {/* Timeline */}
                    <div className="relative space-y-3 sm:space-y-4">
                      <div className="absolute left-[18px] sm:left-[23px] top-4 bottom-4 w-px bg-border" />

                      {learningPath.paths.map((step, i) => {
                        const done = completed.has(step.path_number);
                        return (
                          <motion.div
                            key={`${loadedAnalysisId || selectedAnalysis?.id || "path"}-${step.path_number}-${step.topic}-${i}`}
                            {...anim(0.15 + i * 0.05)}
                            className={`relative pl-11 sm:pl-14 ${done ? "opacity-60" : ""}`}
                          >
                            <div
                              className={`absolute left-0 top-5 h-9 w-9 sm:h-12 sm:w-12 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 z-10
                                ${done
                                  ? "bg-success/20 border-success/40 text-success"
                                  : "bg-card border-border text-foreground shadow-glow"
                                }`}
                            >
                              {step.path_number}
                            </div>

                            <div className={`glass rounded-xl p-4 sm:p-5 gradient-border transition-colors ${done ? "border-success/30 bg-success/5" : ""}`}>
                              <div className="flex items-start justify-between gap-3 sm:gap-4">
                                <div className="flex-1">
                                  <Badge variant="outline" className="mb-2 bg-primary/10 text-primary border-primary/20 text-[10px] uppercase font-semibold">
                                     Gap: {step.skill_gap}
                                  </Badge>
                                  <h3 className={`text-sm sm:text-base font-semibold ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                                    {step.topic}
                                  </h3>
                                  <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                                    {step.description}
                                  </p>
                                  <div className="flex items-center gap-3 mt-4 flex-wrap">
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/80 bg-background px-2 py-1 rounded-md border border-border">
                                      <Clock className="h-3 w-3 text-muted-foreground" /> {step.estimated_hours}h
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning bg-warning/10 px-2 py-1 rounded-md border border-warning/20">
                                      {step.difficulty}
                                    </span>
                                  </div>
                                  
                                  {/* Resources list */}
                                   <div className="mt-4 pt-3 border-t border-border/50 flex flex-col gap-2">
                                     <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recommended Resources</span>
                                     {step.resources.map((r, idx) => (
                                      <div key={`${step.path_number}-${r.title || "resource"}-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-background/40 hover:bg-background/80 border border-transparent hover:border-border transition-colors">
                                          <div className="flex items-center gap-2">
                                             <div className="p-1.5 bg-card border border-border rounded text-muted-foreground shrink-0">
                                                {resourceIcon(r.type)}
                                             </div>
                                             <div>
                                            <div className="text-[11px] sm:text-xs font-medium text-foreground">{r.title}</div>
                                                {(r.platform || r.description) && (
                                              <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[280px] truncate">
                                                      {r.platform && <span className="font-semibold">{r.platform} • </span>}
                                                      {r.description}
                                                   </div>
                                                )}
                                             </div>
                                          </div>
                                          {r.url ? (
                                          <Button variant="ghost" size="sm" className="h-7 text-[10px] shrink-0 hover:bg-primary/20 hover:text-primary whitespace-nowrap" onClick={() => window.open(r.url, '_blank')}>
                                                Open Resource <ArrowRight className="w-3 h-3 ml-1" />
                                             </Button>
                                          ) : (
                                             <span className="text-[10px] text-muted-foreground italic mr-2 whitespace-nowrap">Practice</span>
                                          )}
                                       </div>
                                     ))}
                                  </div>
                                </div>
                                <div className="pt-1 shrink-0">
                                  <Checkbox
                                    checked={done}
                                    onCheckedChange={() => toggle(step.path_number)}
                                    className="h-5 w-5 sm:h-6 sm:w-6 border-border data-[state=checked]:bg-success data-[state=checked]:border-success data-[state=checked]:text-white shadow-sm"
                                  />
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

      </div>
    </DashboardLayout>
  );
};

export default StudyRoom;
