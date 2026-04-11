import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  endInterviewLite,
  getAnalysisHistory,
  startInterviewLite,
  turnInterviewLite,
  sttInterviewLite,
  ttsInterviewLite,
  type InterviewLanguage,
  type InterviewMode,
} from "@/lib/api";
import { Crown, Mic, MicOff, Send, Bot, UserRound, Loader2, Volume2, Play, Pause } from "lucide-react";

type AnalysisHistory = {
  id: string;
  jobTitle: string;
  portal: string;
  created_at: string;
};

type InterviewMessage = {
  role: "assistant" | "user";
  content: string;
};

const LANGUAGE_LABEL: Record<InterviewLanguage, string> = {
  id: "Indonesia",
  en: "English",
  zh: "Chinese",
};

const MODE_LABEL: Record<InterviewMode, string> = {
  text: "Text to Text",
  speech: "Speech to Speech",
};

const INTERVIEW_CACHE_KEY = "fyjob_interview_lite_cache_v1";
type InterviewCacheRecord = Record<string, { messages: InterviewMessage[]; updatedAt: string; mode: InterviewMode; sessionId: string | null }>;

const readInterviewCache = (): InterviewCacheRecord => {
  try {
    const raw = localStorage.getItem(INTERVIEW_CACHE_KEY);
    return raw ? (JSON.parse(raw) as InterviewCacheRecord) : {};
  } catch {
    return {};
  }
};

const writeInterviewCache = (data: InterviewCacheRecord) => {
  try {
    localStorage.setItem(INTERVIEW_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore optional cache failures
  }
};

const InterviewLite = () => {
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>("");
  const [language, setLanguage] = useState<InterviewLanguage>("id");
  const [mode, setMode] = useState<InterviewMode>("text");

  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [maxQuestions, setMaxQuestions] = useState(5);
  const [sessionCost, setSessionCost] = useState<number | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState("");
  const [queueDepth, setQueueDepth] = useState(0);
  const requestQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Speech mode state
  const [isRecording, setIsRecording] = useState(false);
  const [isSttLoading, setIsSttLoading] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAnalysisHistory(20, 0);
        const mapped = (data || []).map((h) => ({
          id: h.id,
          jobTitle: h.jobTitle,
          portal: h.portal,
          created_at: h.created_at,
        }));
        setHistory(mapped);
        if (mapped.length > 0) {
          setSelectedAnalysisId(mapped[0].id);
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load analysis history");
      } finally {
        setIsLoadingHistory(false);
      }
    };

    load();
  }, []);

  const hasAnalysis = history.length > 0;
  const selectedAnalysis = useMemo(
    () => history.find((h) => h.id === selectedAnalysisId) || null,
    [history, selectedAnalysisId]
  );

  const cacheKey = `${selectedAnalysisId || "none"}::${language}::${mode}`;

  const enqueueRequest = async (task: () => Promise<void>) => {
    setQueueDepth((v) => v + 1);
    const run = requestQueueRef.current.then(task, task);
    requestQueueRef.current = run.then(() => undefined, () => undefined);
    try {
      await run;
    } finally {
      setQueueDepth((v) => Math.max(0, v - 1));
    }
  };

  useEffect(() => {
    if (!selectedAnalysisId) return;
    const cache = readInterviewCache();
    const cached = cache[cacheKey];
    setMessages(cached?.messages || []);
    setSessionId(cached?.sessionId || null);
    setTurnCount((cached?.messages || []).filter((m) => m.role === "assistant").length);
    setMaxQuestions(5);
    setSessionCost(mode === "speech" ? 3 : 2);
    setDraftAnswer("");
    setIsAnswering(false);
  }, [selectedAnalysisId, language, mode, cacheKey]);

  useEffect(() => {
    if (!selectedAnalysisId || messages.length === 0) return;
    const cache = readInterviewCache();
    cache[cacheKey] = {
      messages,
      updatedAt: new Date().toISOString(),
      mode,
      sessionId,
    };
    writeInterviewCache(cache);
  }, [messages, selectedAnalysisId, cacheKey, mode, sessionId]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Play TTS for last assistant message when in speech mode
  const playTts = useCallback(async (text: string) => {
    if (!text) return;
    setIsTtsLoading(true);
    try {
      const res = await ttsInterviewLite(text, language);
      // Convert base64 to Blob for reliable playback
      const binaryString = atob(res.audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(blob);
      
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        if (audioPlayerRef.current.src.startsWith("blob:")) {
          URL.revokeObjectURL(audioPlayerRef.current.src);
        }
      }
      const audio = new Audio();
      audio.src = audioUrl;
      audioPlayerRef.current = audio;
      setIsPlayingAudio(true);
      setIsAudioPaused(false);
      audio.onended = () => {
        setIsPlayingAudio(false);
        setIsAudioPaused(false);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        setIsPlayingAudio(false);
        setIsAudioPaused(false);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onpause = () => setIsAudioPaused(true);
      audio.onplay = () => setIsAudioPaused(false);
      audio.play().catch((err) => {
        console.error("Audio playback failed:", err);
        setIsPlayingAudio(false);
      });
    } catch (err) {
      console.error("TTS failed:", err);
      // TTS failure is non-blocking — user can fallback to reading
    } finally {
      setIsTtsLoading(false);
    }
  }, [language]);

  const toggleAudioPlayback = () => {
    const audio = audioPlayerRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const startInterview = async () => {
    if (!selectedAnalysisId) return;
    await enqueueRequest(async () => {
      setError("");
      setMessages([]);
      setDraftAnswer("");
      setIsAnswering(false);
      setIsThinking(true);

      try {
        const res = await startInterviewLite(selectedAnalysisId, language, mode);
        setSessionId(res.sessionId);
        setTurnCount(res.turnCount || 1);
        setMaxQuestions(res.maxQuestions || 5);
        setSessionCost(res.sessionCost ?? (mode === "speech" ? 3 : 2));
        const firstMsg = res.assistantResponse || "Let's begin. Tell me about your approach for this role.";
        setMessages([{ role: "assistant", content: firstMsg }]);
        if (mode === "speech") await playTts(firstMsg);
      } catch (e: any) {
        setError(e?.message || "Failed to start interview");
      } finally {
        setIsThinking(false);
      }
    });
  };

  const sendAnswer = async (answerText?: string) => {
    const answer = answerText ?? draftAnswer;
    if (!selectedAnalysisId || !answer.trim()) return;
    await enqueueRequest(async () => {
      setError("");

      if (!sessionId) {
        setError("Start interview session first.");
        return;
      }

      const nextMessages: InterviewMessage[] = [...messages, { role: "user", content: answer.trim() }];
      setMessages(nextMessages);
      setDraftAnswer("");
      setIsAnswering(false);
      setIsThinking(true);

      try {
        const res = await turnInterviewLite(sessionId, answer.trim());
        setTurnCount(res.turnCount || turnCount);
        setMaxQuestions(res.maxQuestions || 5);
        const aiReply = res.assistantResponse || "Thanks. Next question: explain your trade-off decision process.";
        setMessages((prev) => [...prev, { role: "assistant", content: aiReply }]);
        if (mode === "speech") await playTts(aiReply);
      } catch (e: any) {
        setError(e?.message || "Failed to send answer");
      } finally {
        setIsThinking(false);
      }
    });
  };

  // ── Speech mode helpers ──────────────────────────────────────────────

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // prefer webm; fall back to whatever the browser supports
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(250); // chunk every 250ms
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      setError("Microphone access denied. Allow microphone permission and try again.");
    }
  };

  const stopRecordingAndTranscribe = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    setIsRecording(false);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;

    const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
    audioChunksRef.current = [];

    setIsSttLoading(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const res = await sttInterviewLite(audioBase64, language, blob.type || undefined);
      const transcript = res.transcriptText.trim();
      if (transcript) {
        // submit immediately as the answer
        await sendAnswer(transcript);
      } else {
        setError("No speech detected. Try again.");
        setIsAnswering(true);
      }
    } catch (e: any) {
      setError(e?.message || "Speech recognition failed.");
      setIsAnswering(true);
    } finally {
      setIsSttLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" />
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Premium</Badge>
            </div>
            <h1 className="text-2xl font-bold text-foreground">AI Interview Lite</h1>
            <p className="mt-1 text-sm text-muted-foreground">Push-to-talk style: AI asks, you press answer, then send to continue.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sessionId
                ? `Progress: ${Math.min(turnCount, maxQuestions)}/${maxQuestions} technical questions`
                : `Session cost: ${sessionCost ?? (mode === "speech" ? 3 : 2)} credits (${mode === "speech" ? "speech" : "text"} mode)`}
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <div className="glass rounded-xl p-4 gradient-border space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Interview Context</p>
              <p className="text-xs text-muted-foreground mt-1">Questions are generated from selected analysis + your CV context.</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Interview Language</p>
              <Select value={language} onValueChange={(v) => setLanguage(v as InterviewLanguage)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {(["id", "en", "zh"] as InterviewLanguage[]).map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {LANGUAGE_LABEL[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Interaction Mode</p>
              <Select value={mode} onValueChange={(v) => setMode(v as InterviewMode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {(["text", "speech"] as InterviewMode[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === "speech" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Hold to record → AI transcribes → AI replies in voice.
                </p>
              )}
            </div>

            {isLoadingHistory ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading analysis...
              </div>
            ) : !hasAnalysis ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                Fitur nonaktif. Lakukan minimal 1 job analysis dulu.
              </div>
            ) : (
              <>
                <Select value={selectedAnalysisId} onValueChange={setSelectedAnalysisId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select analysis" />
                  </SelectTrigger>
                  <SelectContent>
                    {history.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.jobTitle} - {h.portal}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedAnalysis && (
                  <div className="rounded-lg border border-border bg-background/60 p-3">
                    <p className="text-sm font-medium text-foreground">{selectedAnalysis.jobTitle}</p>
                    <p className="text-xs text-muted-foreground">{selectedAnalysis.portal}</p>
                  </div>
                )}

                <Button className="w-full" onClick={startInterview} disabled={isThinking || !selectedAnalysisId}>
                  Start Interview
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    if (!sessionId || isThinking) return;
                    await enqueueRequest(async () => {
                      setIsThinking(true);
                      setError("");
                      try {
                        const res = await endInterviewLite(sessionId);
                        setMessages((prev) => [
                          ...prev,
                          {
                            role: "assistant",
                            content: `Interview summary:\n${res.summary || "Session completed."}`,
                          },
                        ]);
                        setSessionId(null);
                        setTurnCount(0);
                      } catch (e: any) {
                        setError(e?.message || "Failed to end interview");
                      } finally {
                        setIsThinking(false);
                      }
                    });
                  }}
                  disabled={!sessionId || isThinking}
                >
                  End Interview
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    const cache = readInterviewCache();
                    delete cache[cacheKey];
                    writeInterviewCache(cache);
                    setMessages([]);
                    setSessionId(null);
                    setTurnCount(0);
                    setMaxQuestions(5);
                    setDraftAnswer("");
                    setIsAnswering(false);
                  }}
                  disabled={!selectedAnalysisId}
                >
                  Clear Cached Session
                </Button>
              </>
            )}
          </div>

          <div className="glass rounded-xl p-4 gradient-border flex min-h-[520px] flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-muted-foreground">
                  Start session to get first interview question.
                </div>
              ) : (
                messages.map((m, idx) => {
                  const isAssistant = m.role === "assistant";
                  const isSpeechMode = mode === "speech";
                  const questionNumber = messages.slice(0, idx + 1).filter((x) => x.role === "assistant").length;
                  
                  // Parse structured format for assistant messages
                  let displayContent = m.content;
                  let questionHeader = null;
                  let hintContent = null;
                  
                  if (isAssistant && /\*\*\s*Pertanyaan Interview/i.test(m.content)) {
                    const questionMatch = m.content.match(/\*\*\s*Pertanyaan Interview[^*]*\*\*\s*([\s\S]*?)(?=\*\*\s*Petunjuk|$)/i);
                    const hintMatch = m.content.match(/\*\*\s*Petunjuk Jawaban Kuat[^*]*\*\*\s*([\s\S]*?)$/i);
                    
                    if (questionMatch) {
                      questionHeader = questionMatch[1].trim();
                      hintContent = hintMatch ? hintMatch[1].trim() : null;
                      displayContent = null;
                    }
                  }
                  
                  return (
                    <div
                      key={`${m.role}-${idx}`}
                      className={`rounded-xl border p-4 text-sm ${isAssistant ? "border-primary/20 bg-primary/5" : "border-border bg-background/60"}`}
                    >
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                        {isAssistant ? "AI Interviewer" : "Your Answer"}
                      </div>
                      
                      {isSpeechMode && isAssistant ? (
                        <p className="leading-relaxed text-foreground/80">
                          AI voice response played.
                        </p>
                      ) : questionHeader ? (
                        <div className="space-y-3">
                          <div>
                            <p className="font-semibold text-primary mb-1.5">Pertanyaan Interview {questionNumber}:</p>
                            <p className="whitespace-pre-line leading-relaxed text-foreground">{questionHeader}</p>
                          </div>
                          {hintContent && (
                            <div className="rounded-lg bg-background/40 p-3 border border-border/50">
                              <p className="font-medium text-foreground/90 mb-1 text-xs">Petunjuk Jawaban Kuat:</p>
                              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">{hintContent}</p>
                            </div>
                          )}
                        </div>
                      ) : displayContent ? (
                        <p className="whitespace-pre-line leading-relaxed text-foreground">{displayContent}</p>
                      ) : (
                        <p className="leading-relaxed text-foreground/80">Voice answer received.</p>
                      )}
                    </div>
                  );
                })
              )}

              {isThinking && (
                <div className="rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> AI is preparing next turn...
                </div>
              )}
              {isTtsLoading && (
                <div className="rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating voice response...
                </div>
              )}
              {isPlayingAudio && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary flex items-center gap-2">
                  <Volume2 className="h-4 w-4" /> Playing AI voice...
                  <Button type="button" size="sm" variant="secondary" className="ml-auto h-7 px-2" onClick={toggleAudioPlayback}>
                    {isAudioPaused ? <Play className="h-3.5 w-3.5 mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                    {isAudioPaused ? "Play" : "Pause"}
                  </Button>
                </div>
              )}
              {isSttLoading && (
                <div className="rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Transcribing speech...
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <div className="mt-4 border-t border-border pt-4 space-y-3">
              {error && <p className="text-sm text-destructive">{error}</p>}
              {queueDepth > 1 && <p className="text-xs text-muted-foreground">Queue: {queueDepth - 1} turn waiting</p>}

              {mode === "speech" ? (
                // ── Speech mode UI ──
                <div className="flex flex-col items-center gap-3">
                  {!isRecording && !isSttLoading && (
                    <Button
                      variant={isAnswering ? "default" : "outline"}
                      className="w-full"
                      onClick={() => {
                        if (!isAnswering) {
                          setIsAnswering(true);
                          startRecording();
                        }
                      }}
                      disabled={!hasAnalysis || messages.length === 0 || isThinking || isTtsLoading || isPlayingAudio}
                    >
                      <Mic className="h-4 w-4 mr-2" /> {isAnswering ? "Recording..." : "Hold to Record Answer"}
                    </Button>
                  )}
                  {isRecording && (
                    <Button
                      variant="destructive"
                      className="w-full animate-pulse"
                      onClick={stopRecordingAndTranscribe}
                    >
                      <MicOff className="h-4 w-4 mr-2" /> Stop & Transcribe
                    </Button>
                  )}
                  {isSttLoading && (
                    <p className="text-xs text-muted-foreground">Sending audio to Azure Speech...</p>
                  )}
                </div>
              ) : (
                // ── Text mode UI ──
                !isAnswering ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setIsAnswering(true)}
                    disabled={!hasAnalysis || messages.length === 0 || isThinking}
                  >
                    <Mic className="h-4 w-4 mr-2" /> Press to Answer
                  </Button>
                ) : (
                  <>
                    <Textarea
                      value={draftAnswer}
                      onChange={(e) => setDraftAnswer(e.target.value)}
                      placeholder="Type your answer here..."
                      className="min-h-[120px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draftAnswer.trim()) {
                          e.preventDefault();
                          sendAnswer();
                        }
                      }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={() => { setIsAnswering(false); setDraftAnswer(""); }}>
                        Cancel
                      </Button>
                      <Button onClick={() => sendAnswer()} disabled={isThinking || !draftAnswer.trim()}>
                        <Send className="h-4 w-4 mr-2" /> Send to AI
                      </Button>
                    </div>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default InterviewLite;
