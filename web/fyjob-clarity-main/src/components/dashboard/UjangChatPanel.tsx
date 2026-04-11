import { useState, useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, Send, Sparkles, Briefcase, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { chatWithUjang, getAnalysisHistory, getUserStats, UserStats } from "@/lib/api";

type Message = {
  role: "ujang" | "user";
  content: string;
};

export const UjangChatPanel = () => {
  const { t } = useTranslation();
  
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "ujang", content: t('ujang_intro') }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  
  const [analyses, setAnalyses] = useState<Array<{id: string, jobTitle: string, portal: string}>>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>("none");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-open if navigating from Extension Quick Match
    const searchParams = new URL(window.location.href).searchParams;
    if (searchParams.get("context") && !isOpen) {
       setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadContextData();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const loadContextData = async () => {
    try {
      const [statsData, histData] = await Promise.all([
        getUserStats(),
        getAnalysisHistory(10, 0)
      ]);
      setStats(statsData);
      setAnalyses(histData);
      // Auto-select context from URL if available
      const searchParams = new URL(window.location.href).searchParams;
      const contextId = searchParams.get("context");

      if (contextId && histData.some(a => a.id === contextId)) {
         setSelectedAnalysisId(contextId);
         // Clean URL manually so it doesn't persist on subsequent local reloads
         window.history.replaceState({}, '', window.location.pathname);
      } else if (histData.length > 0 && selectedAnalysisId === "none") {
         setSelectedAnalysisId(histData[0].id);
      }
    } catch (err) {
      console.error("Failed to load Ujang context", err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    
    // Optimistic UI
    const userMsg = input;
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setIsTyping(true);
    
    try {
      // Format history, skipping the first Ujang intro message to ensure it starts with a 'user' message
      // as required by Gemini's strict alternating roles rules.
      const formattedHistory = messages
        .filter((_, idx) => idx !== 0) // Skip index 0 (the hardcoded intro)
        .map(m => ({ 
           role: m.role === 'ujang' ? 'assistant' : 'user', 
           content: m.content 
        }));

      
      const res = await chatWithUjang(
         userMsg, 
         selectedAnalysisId !== "none" ? selectedAnalysisId : undefined,
         formattedHistory
      );
      
      setMessages(prev => [...prev, { role: "ujang", content: res.response }]);
      
      // Update local credits display
      if (stats) {
         setStats({ ...stats, credits_remaining: res.credits_remaining });
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "ujang", content: `(System Error): ${err.message || "Ujang lagi sibuk mabar ML, coba lagi nanti bro."}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const autofillAction = (text: string) => {
    setInput(text);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground border border-primary/30 flex items-center justify-center hover:bg-primary/90 transition-all z-50 shadow-glow hover:scale-105">
          <MessageCircle className="h-6 w-6" />
        </button>
      </SheetTrigger>
      
      <SheetContent side="right" className="w-full sm:w-[450px] p-0 border-l border-border bg-background flex flex-col">
        <SheetHeader className="p-4 border-b border-border glass-strong flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-3">
               <div className="h-10 w-10 rounded-full bg-primary/20 flex flex-col items-center justify-center border border-primary/50 shrink-0">
                  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' className="h-6 w-6" fill='none' stroke='currentColor' strokeWidth='8' strokeLinecap='round'>
                    <circle cx='50' cy='25' r='10'/>
                    <path d='M50 35v35M30 50h40M30 90l20-20 20 20'/>
                  </svg>
               </div>
               <div className="flex flex-col text-left">
                 <SheetTitle className="text-base text-foreground font-bold">Ujang AI (Ex-FAANG HR)</SheetTitle>
                 <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                   <span className="h-2 w-2 rounded-full bg-success animate-pulse inline-block"></span>Online • Sarcastic Mode
                 </span>
               </div>
             </div>
             {stats !== null && (
                <div className="text-[10px] font-mono bg-card px-2 py-1 rounded-md border border-border flex flex-col items-end">
                <span className="text-muted-foreground uppercase">Mode</span>
                <span className="text-success">Free Chat</span>
                </div>
             )}
          </div>
          
          {/* Context Selector */}
          <div className="flex items-center gap-2 mt-2">
             <span className="text-[10px] uppercase font-semibold text-muted-foreground whitespace-nowrap">Topic:</span>
             <Select value={selectedAnalysisId} onValueChange={setSelectedAnalysisId}>
               <SelectTrigger className="h-7 text-xs bg-card/50 border-border/60">
                 <SelectValue placeholder="Select Job Context" />
               </SelectTrigger>
               <SelectContent>
                 <SelectItem value="none">General Chat (No Context)</SelectItem>
                 {analyses.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.jobTitle} ({a.portal})</SelectItem>
                 ))}
               </SelectContent>
             </Select>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/5">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-primary text-primary-foreground rounded-br-none' 
                  : 'bg-card border border-border text-foreground rounded-bl-none shadow-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {isTyping && (
             <div className="flex justify-start">
               <div className="bg-card border border-border rounded-2xl rounded-bl-none p-4 flex items-center gap-1.5 h-12 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }}></span>
               </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        <div className="p-4 border-t border-border/50 bg-card/40 backdrop-blur-md">
          <div className="flex gap-2 overflow-x-auto pb-3 custom-scrollbar">
            <Button variant="outline" size="sm" className="text-[11px] h-7 whitespace-nowrap bg-background shadow-sm border-border/80" onClick={() => autofillAction("Gimana cara nembus job ini? Apa skill gap paling gede gw sekarang?")}>
              <Briefcase className="w-3 h-3 mr-1.5 text-primary" /> How to pass?
            </Button>
            <Button variant="outline" size="sm" className="text-[11px] h-7 whitespace-nowrap bg-background shadow-sm border-border/80" onClick={() => autofillAction("Kritik CV gw sejujur-jujurnya sesuai standar Google. Gak usah basa-basi.")}>
              <Sparkles className="w-3 h-3 mr-1.5 text-warning" /> Roast my CV
            </Button>
            <Button variant="outline" size="sm" className="text-[11px] h-7 whitespace-nowrap bg-background shadow-sm border-border/80" onClick={() => autofillAction("Gaji wajarnya untuk posisi ini berapa ya? Jangan kasih range bohongan.")}>
              <ChevronRight className="w-3 h-3 mr-1.5 text-success" /> Salary check
            </Button>
          </div>
          
          {/* Chat Input */}
          <div className="flex items-end gap-2 relative">
            <textarea 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                 if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                 }
              }}
              placeholder={selectedAnalysisId !== "none" ? "Tanya soal job ini..." : "Tanya bebas..."} 
              className="flex-1 bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none h-12 max-h-32 custom-scrollbar shadow-inner"
              rows={1}
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-50 shrink-0 hover:bg-primary/90 transition-all shadow-glow"
            >
              {isTyping ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-1" />}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
