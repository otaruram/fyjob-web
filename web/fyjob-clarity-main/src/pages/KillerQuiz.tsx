import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Timer, ChevronLeft, ChevronRight, Check, RefreshCw, AlertCircle, Award } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getAnalysisHistory, generateQuiz, submitQuiz, QuizData } from "@/lib/api";
import { useNavigate } from "react-router-dom";

type AnalysisHistory = {
  id: string; jobTitle: string; portal: string;
  has_quiz: boolean; created_at: string;
};

const KillerQuiz = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisHistory | null>(null);
  
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<any | null>(null);

  // Quiz state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({});
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const h = await getAnalysisHistory(20, 0);
        setHistory(h);
      } catch (err: any) {
        setErrorMsg("Failed to load job history");
      }
    };
    fetchHistory();
  }, []);

  const totalQuestions = quiz ? (quiz.multiple_choice.length + quiz.essay.length) : 0;
  const progress = totalQuestions > 0 ? ((currentIdx + 1) / totalQuestions) * 100 : 0;

  const handleStartQuiz = async (analysis: AnalysisHistory) => {
    try {
      setSelectedAnalysis(analysis);
      setErrorMsg(null);
      setResults(null);
      
      // If it doesn't have a generated quiz, it will cost 1 credit
      // Even if it has one, generateQuiz just returns the cached one
      setIsGenerating(true);
      const res = await generateQuiz(analysis.id);
      
      setQuiz(res.quiz);
      setCurrentIdx(0);
      setMcqAnswers({});
      setEssayAnswers({});
      
      // Update local state to avoid "credit cost" UI later
      setHistory(prev => prev.map(h => h.id === analysis.id ? { ...h, has_quiz: true } : h));
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate quiz");
      setSelectedAnalysis(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const selectMcqAnswer = (qNum: number, optKey: string) => {
    setMcqAnswers(prev => ({ ...prev, [qNum.toString()]: optKey }));
  };

  const handleEssayChange = (qNum: number, text: string) => {
    setEssayAnswers(prev => ({ ...prev, [qNum.toString()]: text }));
  };

  const handleSubmit = async () => {
    if (!quiz || !selectedAnalysis) return;
    
    // Validate all answered (optional, but good UX)
    const mcqAnsweredCount = Object.keys(mcqAnswers).length;
    const essayAnsweredCount = Object.keys(essayAnswers).filter(k => essayAnswers[k].trim() !== "").length;
    
    if (mcqAnsweredCount < quiz.multiple_choice.length || essayAnsweredCount < quiz.essay.length) {
       if (!confirm("You have unanswered questions. Submit anyway?")) return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      
      const res = await submitQuiz(selectedAnalysis.id, {
         multiple_choice: mcqAnswers,
         essay: essayAnswers
      });
      
      setResults(res.results);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit quiz");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDashboard = () => (
    <div className="flex flex-col items-center justify-center p-6 lg:p-10 font-sans text-foreground w-full min-h-[80vh]">
      <div className="glass rounded-xl p-8 max-w-2xl w-full">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2">FAANG-Level Technical Screen</h1>
        <p className="text-muted-foreground mb-8 text-sm">Select a job analysis. If quiz already exists, it opens instantly without regenerate.</p>
        
        {errorMsg && (
          <Alert variant="destructive" className="mb-6 bg-destructive/10 border-destructive/20 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {history.length > 0 ? history.map((job) => (
             <div 
               key={job.id} 
               onClick={() => handleStartQuiz(job)}
               className="p-5 border border-border rounded-xl cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all flex justify-between items-center group relative overflow-hidden text-left"
             >
               <div className="flex-1 min-w-0 pr-4">
                 <h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors truncate">{job.jobTitle}</h3>
                 <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <span className="truncate max-w-[150px] inline-block">{job.portal}</span>
                    <span>•</span>
                    <span>{new Date(job.created_at).toLocaleDateString()}</span>
                 </div>
               </div>
               <div className="shrink-0 flex items-center gap-4">
                <span className="text-xs bg-success/10 text-success px-2 py-1 rounded-md border border-success/20 font-medium">
                  {job.has_quiz ? "Open Saved Quiz" : "Generate Free"}
                </span>
                 <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
               </div>
             </div>
          )) : (
             <div className="text-center p-10 border border-border border-dashed rounded-xl">
                <p className="text-muted-foreground">No analyses found. Scan a job first!</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderGenerating = () => (
     <div className="flex flex-col items-center justify-center p-6 lg:p-10 font-sans text-foreground w-full h-[80vh]">
        <div className="glass rounded-xl p-12 text-center flex flex-col items-center">
           <RefreshCw className="w-12 h-12 text-primary animate-spin mb-6" />
           <h2 className="text-2xl font-bold mb-2 animate-pulse">Consulting technical recruiters...</h2>
           <p className="text-muted-foreground">Drafting questions tailored to {selectedAnalysis?.jobTitle}</p>
        </div>
     </div>
  );

  const renderResults = () => {
    if (!results) return null;
    
    return (
       <div className="flex flex-col items-center p-6 lg:p-10 font-sans text-foreground w-full min-h-[80vh]">
        <div className="glass rounded-xl p-10 max-w-4xl w-full">
           <div className="text-center mb-10 pb-10 border-b border-border">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/20 text-primary mb-6">
                 <Award className="w-10 h-10" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Quiz Completed</h1>
              <p className="text-xl text-muted-foreground">
                 Overall Score: <span className={`font-bold ${results.passed ? 'text-success' : 'text-warning'}`}>{results.overall_score.toFixed(1)} / 100</span>
              </p>
              <div className="mt-4 inline-block px-4 py-2 rounded-full border border-border bg-background">
                 <span className="font-semibold">{results.passed ? '✅ FAANG Ready' : '❌ Needs Review'}</span> 
                 <span className="mx-2 text-muted-foreground">|</span>
                 MCQ: {results.multiple_choice_score}/{results.multiple_choice_total} Correct
              </div>
           </div>

           <div className="space-y-8">
              <h3 className="text-xl font-bold">Feedback Details</h3>
              
              <div className="space-y-4">
                 <h4 className="text-lg font-semibold text-muted-foreground">Multiple Choice</h4>
                 {results.multiple_choice_details.map((mcq: any, i: number) => (
                    <div key={i} className={`p-4 rounded-lg border ${mcq.is_correct ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
                       <div className="flex items-start gap-3">
                          <span className="font-mono mt-0.5">{i+1}.</span>
                          <div className="flex-1">
                             <div className="text-sm">Your answer: <span className="font-semibold">{mcq.user_answer}</span></div>
                             {!mcq.is_correct && <div className="text-sm mt-1">Correct answer: <span className="font-semibold text-success">{mcq.correct_answer}</span></div>}
                             <p className="text-xs text-muted-foreground mt-2">{mcq.explanation}</p>
                          </div>
                       </div>
                    </div>
                 ))}
                 
                 {results.essay_feedback?.length > 0 && (
                  <>
                     <h4 className="text-lg font-semibold text-muted-foreground mt-8">Essay Answers</h4>
                     {results.essay_feedback.map((essay: any, i: number) => (
                        <div key={i} className="p-4 rounded-lg border border-border bg-card/30">
                           <div className="flex justify-between items-center mb-2">
                              <span className="font-semibold">Question {essay.question_number}</span>
                              <Badge variant="outline" className={`${essay.score >= 7 ? 'text-success border-success/30' : 'text-warning border-warning/30'}`}>
                                 Score: {essay.score}/10
                              </Badge>
                           </div>
                           <p className="text-sm text-foreground/90 mb-3">{essay.feedback}</p>
                           {essay.strengths && <p className="text-xs text-success/80 mb-1"><strong>Strengths:</strong> {essay.strengths}</p>}
                           {essay.weaknesses && <p className="text-xs text-warning/80"><strong>Needs Improvement:</strong> {essay.weaknesses}</p>}
                        </div>
                     ))}
                  </>
                 )}
              </div>
              
              <div className="pt-8 text-center">
                 <Button onClick={() => { setSelectedAnalysis(null); setResults(null); setQuiz(null); }}>
                    Return to Dashboard
                 </Button>
              </div>
           </div>
        </div>
       </div>
    )
  }

  const renderActiveQuiz = () => {
    if (!quiz) return null;
    
    // Combine questions for linear navigation
    const allQuestions = [
       ...quiz.multiple_choice.map(q => ({ type: 'mcq', ...q })),
       ...quiz.essay.map(q => ({ type: 'essay', ...q }))
    ];
    
    const currQ = allQuestions[currentIdx] as any;
    
    return (
      <div className="h-[85vh] bg-background flex flex-col border border-border rounded-xl overflow-hidden glass-strong relative animate-in fade-in zoom-in-95 duration-300">
        {/* Top Bar */}
        <div className="h-14 border-b border-border bg-card/60 flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-foreground tracking-tight">
              KILLER<span className="text-primary">QUIZ</span>
            </span>
            <span className="text-xs text-muted-foreground hidden sm:inline">Role: {selectedAnalysis?.jobTitle}</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{currentIdx + 1} / {allQuestions.length}</span>
            </div>
            {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin text-primary" />}
          </div>
        </div>

        {/* Progress */}
        <Progress value={progress} className="h-1 rounded-none bg-border z-20" />

        <div className="flex-1 flex overflow-hidden">
          {/* Question Navigation Sidebar */}
          <div className="w-16 sm:w-20 border-r border-border bg-card/30 flex flex-col items-center py-4 gap-1.5 overflow-y-auto shrink-0 z-10 custom-scrollbar">
            {allQuestions.map((q, i) => {
              const isAnswered = q.type === 'mcq' 
                 ? mcqAnswers[q.question_number.toString()] !== undefined
                 : essayAnswers[q.question_number.toString()]?.trim().length > 0;
              const isCurrent = i === currentIdx;
              
              return (
                <button
                  key={i}
                  onClick={() => setCurrentIdx(i)}
                  className={`relative h-9 w-9 rounded-lg text-xs font-semibold flex items-center justify-center transition-all shrink-0
                    ${isCurrent
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : isAnswered
                        ? "bg-muted text-muted-foreground"
                        : "border border-border text-muted-foreground hover:border-primary/40"
                    }`}
                >
                  {isAnswered && !isCurrent ? <Check className="h-4 w-4" /> : i + 1}
                  {q.type === 'essay' && !isCurrent && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-warning border border-background"></div>}
                </button>
              );
            })}
          </div>

          {/* Main Question Area */}
          <div className="flex-1 flex flex-col p-6 sm:p-10 overflow-y-auto relative pb-32 custom-scrollbar">
            <AnimatePresence mode="wait">
              <motion.div
                key={currQ.question_number + currQ.type}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-3xl mx-auto space-y-6 lg:space-y-8"
              >
                <div className="glass rounded-xl p-6 lg:p-8 gradient-border">
                  <Badge variant="outline" className={`${currQ.type === 'mcq' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-warning/10 text-warning border-warning/20'} mb-4 uppercase text-[10px]`}>
                    {currQ.type === 'mcq' ? 'Multiple Choice' : 'Code / Architecture Scenario'}
                  </Badge>
                  <p className="text-lg lg:text-xl font-medium text-foreground leading-relaxed">
                    {currQ.question}
                  </p>
                </div>

                {currQ.type === 'mcq' ? (
                  <div className="grid gap-3">
                    {['A', 'B', 'C', 'D'].map((optKey) => {
                      const optText = currQ.options[optKey];
                      if (!optText) return null;
                      const isSelected = mcqAnswers[currQ.question_number] === optKey;
                      return (
                        <button
                          key={optKey}
                          onClick={() => selectMcqAnswer(currQ.question_number, optKey)}
                          className={`text-left p-4 lg:p-5 rounded-xl border transition-all text-sm leading-relaxed flex gap-4
                            ${isSelected
                              ? "border-primary bg-primary/10 text-foreground shadow-md"
                              : "border-border bg-card/30 text-muted-foreground hover:border-primary/40 hover:bg-card/80"
                            }`}
                        >
                          <span className="font-mono font-bold shrink-0">{optKey}.</span>
                          <span>{optText}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Textarea 
                       value={essayAnswers[currQ.question_number] || ''}
                       onChange={(e) => handleEssayChange(currQ.question_number, e.target.value)}
                       placeholder="Explain your approach, trade-offs, and architecture decisions here. Minimum 50 words recommended."
                        className="min-h-[250px] p-5 text-sm/relaxed font-mono bg-zinc-950/90 border-border shadow-inner resize-y custom-scrollbar text-zinc-100 caret-zinc-100 placeholder:text-zinc-500 selection:bg-primary/40"
                    />
                    <p className="text-xs text-muted-foreground">This answer will be evaluated by the LLM based on technical accuracy, depth, and communication clarity.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          
          {/* Bottom Nav Area */}
          <div className="absolute bottom-0 right-0 left-16 sm:left-20 bg-background/80 backdrop-blur-md border-t border-border p-4 flex items-center justify-between pointer-events-auto">
             <Button
               variant="outline"
               disabled={currentIdx === 0 || isSubmitting}
               onClick={() => setCurrentIdx((p) => p - 1)}
               className="bg-card w-28"
             >
               <ChevronLeft className="h-4 w-4 mr-2" /> Prev
             </Button>
             
             {currentIdx === allQuestions.length - 1 ? (
               <Button onClick={handleSubmit} disabled={isSubmitting} className="w-40 font-bold shadow-glow text-white">
                 Submit Appraisal <Check className="w-4 h-4 ml-2" />
               </Button>
             ) : (
               <Button
                 onClick={() => setCurrentIdx((p) => Math.min(allQuestions.length - 1, p + 1))}
                 className="w-28"
               >
                 Next <ChevronRight className="h-4 w-4 ml-2" />
               </Button>
             )}
          </div>
        </div>

        <button 
          onClick={() => {
             if (confirm("Are you sure you want to exit? Your progress will be lost.")) {
                setSelectedAnalysis(null);
                setQuiz(null);
             }
          }}
          className="absolute top-16 right-6 px-3 py-1.5 rounded-lg bg-background border border-border flex items-center text-xs font-medium hover:bg-destructive hover:text-white hover:border-destructive transition-colors shadow-lg z-50 text-muted-foreground"
        >
          Exit Quiz
        </button>
      </div>
    );
  };

  return (
    <DashboardLayout>
       {results ? renderResults() : 
        selectedAnalysis ? 
           (isGenerating ? renderGenerating() : renderActiveQuiz()) 
        : renderDashboard()}
    </DashboardLayout>
  );
};

export default KillerQuiz;
