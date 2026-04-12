import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  endInterviewLite,
  getAnalysisHistory,
  getUserStats,
  startInterviewLite,
  turnInterviewLite,
  sttInterviewLite,
  ttsInterviewLite,
  type InterviewLanguage,
  type InterviewMode,
} from "@/lib/api";
import { Crown, Mic, MicOff, Send, Bot, UserRound, Loader2, Play, Pause, RotateCcw, Volume2 } from "lucide-react";

type AnalysisHistory = {
  id: string;
  jobTitle: string;
  portal: string;
  created_at: string;
};

type InterviewMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  audioUrl?: string | null;
  audioMimeType?: string | null;
};

type CachedInterviewMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type InterviewCacheRecord = Record<
  string,
  {
    messages: CachedInterviewMessage[];
    updatedAt: string;
    mode: InterviewMode;
    sessionId: string | null;
  }
>;

type ParsedAssistantMessage = {
  evaluation: string[];
  questionTitle: string | null;
  questionBody: string[];
  hintPoints: string[];
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

const makeMessageId = () => {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `msg_${randomPart}`;
};

const normalizeCachedMessages = (messages: Partial<CachedInterviewMessage>[] | undefined): InterviewMessage[] => {
  return (messages || [])
    .filter((message): message is Partial<CachedInterviewMessage> & { role: "assistant" | "user"; content: string } => {
      return (message?.role === "assistant" || message?.role === "user") && typeof message?.content === "string";
    })
    .map((message) => ({
      id: typeof message.id === "string" && message.id.trim() ? message.id : makeMessageId(),
      role: message.role,
      content: message.content,
      audioUrl: null,
      audioMimeType: null,
    }));
};

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

const toCachedMessages = (messages: InterviewMessage[]): CachedInterviewMessage[] => {
  return messages.map(({ id, role, content }) => ({ id, role, content }));
};

const sanitizeDisplayLine = (value: string) => {
  return value.replace(/[*_#`~]+/g, "").trim();
};

const stripBulletPrefix = (value: string) => {
  return sanitizeDisplayLine(value).replace(/^[•\-\u2013\u2014\s]+/, "").trim();
};

const parseAssistantMessage = (content: string): ParsedAssistantMessage | null => {
  const parsed: ParsedAssistantMessage = {
    evaluation: [],
    questionTitle: null,
    questionBody: [],
    hintPoints: [],
  };

  let currentSection: "evaluation" | "question" | "hint" | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = sanitizeDisplayLine(rawLine);
    if (!line) {
      continue;
    }

    const lower = line.toLowerCase();
    if (lower.startsWith("evaluasi jawaban")) {
      currentSection = "evaluation";
      const remainder = line.replace(/^[^:]+:/, "").trim();
      if (remainder) parsed.evaluation.push(stripBulletPrefix(remainder));
      continue;
    }

    if (lower.startsWith("pertanyaan interview")) {
      currentSection = "question";
      const titleMatch = line.match(/^(Pertanyaan Interview\s*\d*)\s*:/i);
      parsed.questionTitle = titleMatch?.[1] || "Pertanyaan Interview";
      const remainder = line.replace(/^[^:]+:/, "").trim();
      if (remainder) parsed.questionBody.push(remainder);
      continue;
    }

    if (lower.startsWith("poin jawaban kuat") || lower.startsWith("petunjuk jawaban kuat")) {
      currentSection = "hint";
      const remainder = line.replace(/^[^:]+:/, "").trim();
      if (remainder) parsed.hintPoints.push(stripBulletPrefix(remainder));
      continue;
    }

    if (currentSection === "evaluation") {
      parsed.evaluation.push(stripBulletPrefix(line));
    } else if (currentSection === "question") {
      parsed.questionBody.push(line);
    } else if (currentSection === "hint") {
      parsed.hintPoints.push(stripBulletPrefix(line));
    }
  }

  if (!parsed.evaluation.length && !parsed.questionBody.length && !parsed.hintPoints.length) {
    return null;
  }

  return parsed;
};

const InterviewLite = () => {
  const navigate = useNavigate();
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>("");
  const [language, setLanguage] = useState<InterviewLanguage>("id");
  const [mode, setMode] = useState<InterviewMode>("text");
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [qualityMode, setQualityMode] = useState<"lite" | "deep">("lite");
  const [interviewEnabled, setInterviewEnabled] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

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
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const requestQueueRef = useRef<Promise<void>>(Promise.resolve());

  const [isRecording, setIsRecording] = useState(false);
  const [isSttLoading, setIsSttLoading] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [activeAudioMessageId, setActiveAudioMessageId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<Set<string>>(new Set());
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<InterviewMessage[]>([]);

  const registerAudioUrl = useCallback((audioUrl: string) => {
    audioUrlsRef.current.add(audioUrl);
    return audioUrl;
  }, []);

  const cleanupAudioPlayback = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.removeAttribute("src");
      audioPlayerRef.current.load();
    }
    setIsPlayingAudio(false);
    setIsAudioPaused(false);
    setActiveAudioMessageId(null);
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      cleanupAudioPlayback();
      for (const audioUrl of audioUrlsRef.current) {
        URL.revokeObjectURL(audioUrl);
      }
      audioUrlsRef.current.clear();
    };
  }, [cleanupAudioPlayback]);

  const getAudioPlayer = useCallback(() => {
    if (!audioPlayerRef.current) {
      const audio = new Audio();
      audio.onended = () => {
        setIsPlayingAudio(false);
        setIsAudioPaused(false);
        setActiveAudioMessageId(null);
      };
      audio.onpause = () => {
        if (!audio.ended && audio.currentTime > 0) {
          setIsPlayingAudio(false);
          setIsAudioPaused(true);
        }
      };
      audio.onplay = () => {
        setIsPlayingAudio(true);
        setIsAudioPaused(false);
      };
      audioPlayerRef.current = audio;
    }
    return audioPlayerRef.current;
  }, []);

  const playAudioSource = useCallback(
    async (messageId: string, audioUrl: string, restart = false) => {
      const audio = getAudioPlayer();
      if (audio.src !== audioUrl) {
        audio.src = audioUrl;
      }
      if (restart) {
        audio.currentTime = 0;
      }
      setActiveAudioMessageId(messageId);
      setIsPlayingAudio(true);
      setIsAudioPaused(false);
      try {
        await audio.play();
      } catch (playError) {
        console.error("Audio playback failed:", playError);
        setIsPlayingAudio(false);
      }
    },
    [getAudioPlayer]
  );

  const playMessageAudio = useCallback(
    async (messageId: string, restart = false) => {
      const message = messagesRef.current.find((item) => item.id === messageId);
      if (!message?.audioUrl) return;
      await playAudioSource(messageId, message.audioUrl, restart);
    },
    [playAudioSource]
  );

  const toggleMessageAudio = useCallback(
    (messageId: string) => {
      const message = messagesRef.current.find((item) => item.id === messageId);
      if (!message?.audioUrl) return;

      const audio = getAudioPlayer();
      if (activeAudioMessageId !== messageId || audio.src !== message.audioUrl) {
        void playAudioSource(messageId, message.audioUrl, true);
        return;
      }

      if (audio.paused) {
        void audio.play().catch(() => {
          setIsPlayingAudio(false);
        });
      } else {
        audio.pause();
      }
    },
    [activeAudioMessageId, getAudioPlayer, playAudioSource]
  );

  const replayMessageAudio = useCallback(
    (messageId: string) => {
      void playMessageAudio(messageId, true);
    },
    [playMessageAudio]
  );

  const synthesizeAssistantAudio = useCallback(
    async (messageId: string, text: string, autoPlay = true) => {
      if (!text) return;

      setIsTtsLoading(true);
      try {
        const res = await ttsInterviewLite(text, language);
        const binaryString = atob(res.audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let index = 0; index < binaryString.length; index++) {
          bytes[index] = binaryString.charCodeAt(index);
        }
        const mimeType = res.outputFormat?.toLowerCase().includes("mp3") ? "audio/mpeg" : "audio/wav";
        const blob = new Blob([bytes], { type: mimeType });
        const audioUrl = registerAudioUrl(URL.createObjectURL(blob));

        setMessages((prev) =>
          prev.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  audioUrl,
                  audioMimeType: mimeType,
                }
              : message
          )
        );

        if (autoPlay) {
          await playAudioSource(messageId, audioUrl, true);
        }
      } catch (ttsError) {
        console.error("TTS failed:", ttsError);
      } finally {
        setIsTtsLoading(false);
      }
    },
    [language, playAudioSource, registerAudioUrl]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const stats = await getUserStats();
        const adminMode = stats?.role === "admin";
        setIsAdmin(adminMode);
        setInterviewEnabled(Boolean(stats?.interview_access?.enabled || adminMode));
        setSpeechEnabled(Boolean(stats?.interview_access?.speech_enabled || adminMode));
        setQualityMode((stats?.interview_access?.quality as "lite" | "deep") || (adminMode ? "deep" : "lite"));
        setSessionCost(adminMode ? 0 : mode === "speech" ? 3 : 2);

        const data = await getAnalysisHistory(20, 0);
        const mapped = (data || []).map((item) => ({
          id: item.id,
          jobTitle: item.jobTitle,
          portal: item.portal,
          created_at: item.created_at,
        }));
        setHistory(mapped);
        if (mapped.length > 0) {
          setSelectedAnalysisId(mapped[0].id);
        }
      } catch (loadError: any) {
        setError(loadError?.message || "Failed to load analysis history");
      } finally {
        setIsLoadingHistory(false);
      }
    };

    load();
  }, [mode]);

  const hasAnalysis = history.length > 0;
  const selectedAnalysis = useMemo(
    () => history.find((item) => item.id === selectedAnalysisId) || null,
    [history, selectedAnalysisId]
  );

  const cacheKey = `${selectedAnalysisId || "none"}::${language}::${mode}`;

  const enqueueRequest = async (task: () => Promise<void>) => {
    setQueueDepth((value) => value + 1);
    const run = requestQueueRef.current.then(task, task);
    requestQueueRef.current = run.then(() => undefined, () => undefined);
    try {
      await run;
    } finally {
      setQueueDepth((value) => Math.max(0, value - 1));
    }
  };

  useEffect(() => {
    if (!selectedAnalysisId) return;
    cleanupAudioPlayback();
    const cache = readInterviewCache();
    const cached = cache[cacheKey];
    const normalizedMessages = normalizeCachedMessages(cached?.messages);
    setMessages(normalizedMessages);
    setSessionId(cached?.sessionId || null);
    setRestoredFromCache(Boolean(cached?.sessionId && normalizedMessages.length > 0));
    setTurnCount(normalizedMessages.filter((message) => message.role === "assistant").length);
    setMaxQuestions(5);
    setSessionCost(isAdmin ? 0 : mode === "speech" ? 3 : 2);
    setDraftAnswer("");
    setIsAnswering(false);
  }, [selectedAnalysisId, language, mode, cacheKey, cleanupAudioPlayback, isAdmin]);

  useEffect(() => {
    if (!selectedAnalysisId || messages.length === 0) return;
    const cache = readInterviewCache();
    cache[cacheKey] = {
      messages: toCachedMessages(messages),
      updatedAt: new Date().toISOString(),
      mode,
      sessionId,
    };
    writeInterviewCache(cache);
  }, [messages, selectedAnalysisId, cacheKey, mode, sessionId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const startInterview = async () => {
    if (!selectedAnalysisId) return;
    if (mode === "speech" && !speechEnabled) {
      setError("Speech mode hanya untuk Pro/Admin plan.");
      return;
    }
    if (sessionId && messages.length > 0) {
      setError("");
      setRestoredFromCache(true);
      return;
    }

    await enqueueRequest(async () => {
      setError("");
      setMessages([]);
      setDraftAnswer("");
      setIsAnswering(false);
      setIsThinking(true);
      cleanupAudioPlayback();

      try {
        const res = await startInterviewLite(selectedAnalysisId, language, mode);
        const assistantId = makeMessageId();
        const firstMessage = res.assistantResponse || "Mari mulai. Jelaskan pendekatan teknis Anda untuk role ini.";
        const effectiveCost = isAdmin ? 0 : mode === "speech" ? 3 : Math.max(1, res.sessionCost ?? 2);

        setSessionId(res.sessionId);
        setTurnCount(res.turnCount || 1);
        setMaxQuestions(res.maxQuestions || 5);
        setSessionCost(effectiveCost);
        setMessages([{ id: assistantId, role: "assistant", content: firstMessage }]);
        setRestoredFromCache(false);

        if (mode === "speech") {
          await synthesizeAssistantAudio(assistantId, firstMessage, true);
        }
      } catch (startError: any) {
        setError(startError?.message || "Failed to start interview");
      } finally {
        setIsThinking(false);
      }
    });
  };

  const sendAnswer = async (payload?: { text?: string; audioUrl?: string | null; audioMimeType?: string | null }) => {
    const answer = payload?.text ?? draftAnswer;
    if (!selectedAnalysisId || !answer.trim()) return;

    await enqueueRequest(async () => {
      setError("");

      if (!sessionId) {
        setError("Start interview session first.");
        return;
      }

      const userMessage: InterviewMessage = {
        id: makeMessageId(),
        role: "user",
        content: answer.trim(),
        audioUrl: payload?.audioUrl || null,
        audioMimeType: payload?.audioMimeType || null,
      };

      setMessages((prev) => [...prev, userMessage]);
      setDraftAnswer("");
      setIsAnswering(false);
      setIsThinking(true);

      try {
        const res = await turnInterviewLite(sessionId, answer.trim());
        const assistantId = makeMessageId();
        const aiReply = res.assistantResponse || "Evaluasi Jawaban:\n• Jawaban Anda perlu lebih spesifik.\n\nPertanyaan Interview 2:\nJelaskan trade-off teknis yang Anda pilih.\n\nPoin Jawaban Kuat:\n• Beri langkah kerja.\n• Jelaskan alasan teknis.\n• Sebutkan hasil yang diukur.";
        setTurnCount(res.turnCount || turnCount);
        setMaxQuestions(res.maxQuestions || 5);
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: aiReply }]);

        if (mode === "speech") {
          await synthesizeAssistantAudio(assistantId, aiReply, true);
        }
      } catch (turnError: any) {
        setError(turnError?.message || "Failed to send answer");
      } finally {
        setIsThinking(false);
      }
    });
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.start(250);
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
    recorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;

    const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
    audioChunksRef.current = [];

    setIsSttLoading(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let audioBase64 = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        audioBase64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      audioBase64 = btoa(audioBase64);
      const audioUrl = registerAudioUrl(URL.createObjectURL(blob));
      const res = await sttInterviewLite(audioBase64, language, blob.type || undefined);
      const transcript = res.transcriptText.trim();
      if (transcript) {
        await sendAnswer({
          text: transcript,
          audioUrl,
          audioMimeType: blob.type || "audio/webm",
        });
      } else {
        setError("No speech detected. Try again.");
        setIsAnswering(false);
      }
    } catch (speechError: any) {
      setError(speechError?.message || "Speech recognition failed.");
      setIsAnswering(false);
    } finally {
      setIsSttLoading(false);
    }
  };

  const clearCachedSession = () => {
    cleanupAudioPlayback();
    const cache = readInterviewCache();
    delete cache[cacheKey];
    writeInterviewCache(cache);
    setMessages([]);
    setSessionId(null);
    setTurnCount(0);
    setMaxQuestions(5);
    setDraftAnswer("");
    setIsAnswering(false);
    setRestoredFromCache(false);
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
            <p className="mt-1 text-sm text-muted-foreground">Push-to-talk style: AI asks, you answer, lalu AI langsung evaluasi dan lanjut ke pertanyaan berikutnya.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sessionId
                ? `Progress: ${Math.min(turnCount, maxQuestions)}/${maxQuestions} technical questions`
                : `Session cost: ${sessionCost ?? (isAdmin ? 0 : mode === "speech" ? 3 : 2)} credits (${mode === "speech" ? "speech" : "text"} mode)`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Interview quality: {qualityMode === "deep" ? "Deep Coach" : "Lite Coach"}</p>
            {!interviewEnabled && (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                Interview Lite khusus Basic/Pro plan. Upgrade dulu untuk mulai latihan interview.
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/upgrade")}>Upgrade Plan</Button>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <div className="glass rounded-xl space-y-4 p-4 gradient-border">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Interview Context</p>
              <p className="mt-1 text-xs text-muted-foreground">Questions are generated from selected analysis + your CV context.</p>
            </div>

            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Interview Language</p>
              <Select value={language} onValueChange={(value) => setLanguage(value as InterviewLanguage)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {(["id", "en", "zh"] as InterviewLanguage[]).map((item) => (
                    <SelectItem key={item} value={item}>
                      {LANGUAGE_LABEL[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Interaction Mode</p>
              <Select
                value={mode}
                onValueChange={(value) => {
                  const nextMode = value as InterviewMode;
                  if (nextMode === "speech" && !speechEnabled) {
                    setError("Speech mode hanya untuk Pro/Admin plan.");
                    return;
                  }
                  setMode(nextMode);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {(["text", "speech"] as InterviewMode[]).map((item) => (
                    <SelectItem key={item} value={item}>
                      {item === "speech" && !speechEnabled ? `${MODE_LABEL[item]} (Pro/Admin)` : MODE_LABEL[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === "speech" && (
                <p className="mt-1 text-[11px] text-muted-foreground">Record jawaban, AI transcribes, lalu AI menjawab dengan teks dan suara otomatis.</p>
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
                    {history.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.jobTitle} - {item.portal}
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

                <Button className="w-full" onClick={startInterview} disabled={!interviewEnabled || isThinking || !selectedAnalysisId}>
                  {sessionId && messages.length > 0 ? "Resume Session" : "Start Interview"}
                </Button>
                {restoredFromCache && (
                  <p className="text-[11px] text-muted-foreground">Session lokal ditemukan. Klik Resume Session untuk lanjut tanpa generate ulang pertanyaan awal.</p>
                )}
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
                            id: makeMessageId(),
                            role: "assistant",
                            content: `Interview summary:\n${res.summary || "Session completed."}`,
                          },
                        ]);
                        setSessionId(null);
                        setTurnCount(0);
                      } catch (endError: any) {
                        setError(endError?.message || "Failed to end interview");
                      } finally {
                        setIsThinking(false);
                      }
                    });
                  }}
                  disabled={!sessionId || isThinking}
                >
                  End Interview
                </Button>
                <Button variant="ghost" className="w-full" onClick={clearCachedSession} disabled={!selectedAnalysisId}>
                  Clear Cached Session
                </Button>
              </>
            )}
          </div>

          <div className="glass gradient-border flex min-h-[520px] flex-col rounded-xl p-4">
            <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                  Start session to get first interview question.
                </div>
              ) : (
                messages.map((message, index) => {
                  const isAssistant = message.role === "assistant";
                  const parsedAssistant = isAssistant ? parseAssistantMessage(message.content) : null;
                  const isActiveAudio = activeAudioMessageId === message.id;
                  const canPlayAudio = Boolean(message.audioUrl);

                  return (
                    <div
                      key={message.id}
                      className={`rounded-xl border p-4 text-sm ${isAssistant ? "border-primary/20 bg-primary/5" : "border-border bg-background/60"}`}
                    >
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                        {isAssistant ? "AI Interviewer" : "Your Answer"}
                      </div>

                      {parsedAssistant ? (
                        <div className="space-y-3">
                          {parsedAssistant.evaluation.length > 0 && (
                            <div>
                              <p className="mb-1.5 font-semibold text-foreground">Evaluasi Jawaban</p>
                              <ul className="space-y-1.5 text-foreground/90">
                                {parsedAssistant.evaluation.map((point) => (
                                  <li key={`${message.id}-eval-${point}`} className="flex items-start gap-2 leading-relaxed">
                                    <span className="mt-1 text-xs text-primary">•</span>
                                    <span>{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {parsedAssistant.questionBody.length > 0 && (
                            <div>
                              <p className="mb-1.5 font-semibold text-primary">{parsedAssistant.questionTitle || `Pertanyaan Interview ${index + 1}`}</p>
                              <div className="space-y-1.5 text-foreground">
                                {parsedAssistant.questionBody.map((line) => (
                                  <p key={`${message.id}-question-${line}`} className="whitespace-pre-line leading-relaxed">
                                    {line}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          {parsedAssistant.hintPoints.length > 0 && (
                            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                              <p className="mb-1.5 text-xs font-medium text-foreground/90">Poin Jawaban Kuat</p>
                              <ul className="space-y-1.5 text-foreground/85">
                                {parsedAssistant.hintPoints.map((point) => (
                                  <li key={`${message.id}-hint-${point}`} className="flex items-start gap-2 leading-relaxed">
                                    <span className="mt-1 text-xs text-primary">•</span>
                                    <span>{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="whitespace-pre-line leading-relaxed text-foreground">{message.content}</p>
                      )}

                      {canPlayAudio && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                          <Button type="button" size="sm" variant="secondary" className="h-8 px-3" onClick={() => toggleMessageAudio(message.id)}>
                            {isActiveAudio && isPlayingAudio && !isAudioPaused ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                            {isActiveAudio && isPlayingAudio && !isAudioPaused ? "Pause" : "Play"}
                          </Button>
                          <Button type="button" size="sm" variant="outline" className="h-8 px-3" onClick={() => replayMessageAudio(message.id)}>
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Replay
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {isAssistant ? "AI voice" : "Your recording"}
                            {isActiveAudio && (isPlayingAudio || isAudioPaused) ? ` • ${isAudioPaused ? "paused" : "playing"}` : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {isThinking && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> AI is preparing next turn...
                </div>
              )}
              {isTtsLoading && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating voice response...
                </div>
              )}
              {isPlayingAudio && activeAudioMessageId && (
                <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                  <Volume2 className="h-4 w-4" /> Audio sedang diputar.
                </div>
              )}
              {isSttLoading && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Transcribing speech...
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <div className="mt-4 space-y-3 border-t border-border pt-4">
              {error && <p className="text-sm text-destructive">{error}</p>}
              {queueDepth > 1 && <p className="text-xs text-muted-foreground">Queue: {queueDepth - 1} turn waiting</p>}

              {mode === "speech" ? (
                <div className="flex flex-col items-center gap-3">
                  {!isRecording && !isSttLoading && (
                    <Button
                      variant={isAnswering ? "default" : "outline"}
                      className="w-full"
                      onClick={() => {
                        if (!isAnswering) {
                          setIsAnswering(true);
                          void startRecording();
                        }
                      }}
                      disabled={!hasAnalysis || messages.length === 0 || isThinking || isTtsLoading}
                    >
                      <Mic className="mr-2 h-4 w-4" /> {isAnswering ? "Recording..." : "Start Recording Answer"}
                    </Button>
                  )}
                  {isRecording && (
                    <Button variant="destructive" className="w-full animate-pulse" onClick={stopRecordingAndTranscribe}>
                      <MicOff className="mr-2 h-4 w-4" /> Stop & Send Answer
                    </Button>
                  )}
                  {isSttLoading && <p className="text-xs text-muted-foreground">Sending audio to Azure Speech...</p>}
                </div>
              ) : !isAnswering ? (
                <Button variant="outline" className="w-full" onClick={() => setIsAnswering(true)} disabled={!hasAnalysis || messages.length === 0 || isThinking}>
                  <Mic className="mr-2 h-4 w-4" /> Press to Answer
                </Button>
              ) : (
                <>
                  <Textarea
                    value={draftAnswer}
                    onChange={(event) => setDraftAnswer(event.target.value)}
                    placeholder="Type your answer here..."
                    className="min-h-[120px]"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && draftAnswer.trim()) {
                        event.preventDefault();
                        void sendAnswer();
                      }
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsAnswering(false);
                        setDraftAnswer("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button onClick={() => void sendAnswer()} disabled={isThinking || !draftAnswer.trim()}>
                      <Send className="mr-2 h-4 w-4" /> Send to AI
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default InterviewLite;
