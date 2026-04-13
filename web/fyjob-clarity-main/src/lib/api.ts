import { supabase } from './supabase';

const DEFAULT_CLOUD_API_BASE_URL = 'https://fypodku-g4f2avb0aaewcyaw.indonesiacentral-01.azurewebsites.net';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const FALLBACK_API_BASE_URL = (
  import.meta.env.VITE_API_FALLBACK_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:7071' : DEFAULT_CLOUD_API_BASE_URL)
).replace(/\/$/, '');

const ORIGIN_API_BASE_URL = (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '');

const getApiBaseCandidates = () => {
  const candidates = [FALLBACK_API_BASE_URL, API_BASE_URL, ORIGIN_API_BASE_URL].filter(Boolean);
  return [...new Set(candidates)];
};

const buildRequestInit = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', token: string, body?: any): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: body ? JSON.stringify(body) : undefined,
});

const requestAcrossBases = async (
  endpoint: string,
  requestInit: RequestInit,
  baseCandidates: string[]
): Promise<Response> => {
  let lastNetworkError: unknown = null;
  let lastResponse: Response | null = null;

  for (const base of baseCandidates) {
    try {
      const response = await fetch(`${base}${endpoint}`, requestInit);
      const contentType = response.headers.get('content-type') || '';
      const expectsJson = endpoint.startsWith('/api/');

      // If this base doesn't expose the endpoint, try the next candidate.
      if (response.status === 404) {
        lastResponse = response;
        continue;
      }

      // If a base returns HTML (or any non-JSON) for API endpoint,
      // it's likely the wrong host. Continue trying other candidates.
      if (expectsJson && response.ok && !contentType.toLowerCase().includes('application/json')) {
        lastResponse = response;
        continue;
      }

      return response;
    } catch (networkErr) {
      lastNetworkError = networkErr;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Failed to connect to API');
};

const decodeJwtPayload = (token?: string | null) => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const getJwtExpiration = (token?: string | null) => {
  const exp = Number(decodeJwtPayload(token)?.exp);
  return Number.isFinite(exp) ? exp : null;
};

const getEffectiveSessionExpiry = (token?: string | null, expiresAt?: number | null) => {
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) return expiresAt;
  return getJwtExpiration(token);
};

const isSessionExpiringSoon = (token?: string | null, expiresAt?: number | null, bufferSeconds = 300) => {
  const effectiveExpiry = getEffectiveSessionExpiry(token, expiresAt);
  if (!effectiveExpiry) return false;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return effectiveExpiry <= nowInSeconds + bufferSeconds;
};

let refreshSessionPromise: Promise<string | null> | null = null;

const refreshAuthToken = async (reason: string) => {
  if (!refreshSessionPromise) {
    refreshSessionPromise = (async () => {
      console.warn(`[FYJOB API] ${reason}; attempting refreshSession...`);
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshData?.session?.access_token) {
        console.log('[FYJOB API] refreshSession succeeded');
        return refreshData.session.access_token;
      }

      console.error('[FYJOB API] No valid session found', refreshError);
      return null;
    })();

    refreshSessionPromise.finally(() => {
      refreshSessionPromise = null;
    });
  }

  return refreshSessionPromise;
};

/**
 * Gets a valid JWT token from Supabase for backend API calls.
 * Tries cached session first, then forces a refresh if stale.
 */
export const getAuthToken = async (): Promise<string | null> => {
  // 1. Try cached session
  const { data: { session }, error } = await supabase.auth.getSession();
  if (session?.access_token && !isSessionExpiringSoon(session.access_token, session.expires_at)) return session.access_token;

  // 2. Cached session is empty/stale — attempt a forced refresh
  return refreshAuthToken(error ? 'getSession failed' : 'cached session is stale');
};

/**
 * Core API caller — auto-injects Supabase JWT.
 */
export const fetchApi = async <T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  allowRetry = true
): Promise<T> => {
  const token = await getAuthToken();
  if (!token) throw new Error("Authentication required. Please login first.");

  const baseCandidates = getApiBaseCandidates();
  if (!baseCandidates.length) {
    throw new Error('API base URL not configured. Set VITE_API_BASE_URL.');
  }

  const requestInit = buildRequestInit(method, token, body);
  const response = await requestAcrossBases(endpoint, requestInit, baseCandidates);

  if (!response.ok) {
    if (response.status === 401 && allowRetry) {
      const refreshedToken = await refreshAuthToken('received 401 from backend');
      if (refreshedToken && refreshedToken !== token) {
        return fetchApi<T>(endpoint, method, body, false);
      }
    }

    let errorData;
    try { errorData = await response.json(); } catch { /* ignore */ }

    if (response.status === 401) {
      throw new Error("Session expired. Please refresh and try again.");
    }
    if (response.status === 403) {
      throw new Error(errorData?.error || "Insufficient credits. Wait for daily regen (+1/day at midnight).");
    }
    throw new Error(errorData?.error || `API Error: ${response.status}`);
  }

  const safeClone = response.clone();
  try {
    return await response.json();
  } catch {
    const raw = (await safeClone.text()).trim();
    const preview = raw.slice(0, 140);
    throw new Error(preview ? `Invalid API JSON response: ${preview}` : 'Invalid API JSON response');
  }
};

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface UserStats {
  credits_remaining: number;
  max_credits: number | string;
  role: 'admin' | 'user';
  plan?: 'free' | 'basic' | 'pro' | 'admin';
  plan_expires_at?: string | null;
  plan_expiry_notice?: string | null;
  welcome_notice?: string | null;
  interview_access?: {
    enabled?: boolean;
    quality: 'lite' | 'deep';
    speech_enabled: boolean;
    event_active?: boolean;
  };
  next_regen_time: string;
  total_analyses: number;
  avg_match_score: number;
  recent_analyses: Array<{
    id: string;
    jobTitle: string;
    portal: string;
    created_at: string;
    score: number;
    has_quiz: boolean;
    has_learning_path: boolean;
  }>;
  skill_gaps: Array<{ name: string; frequency: number }>;
  cv_uploaded: boolean;
  cv_filename: string;
  timezone: string;
}

export interface AnalysisResult {
  matchScore: number;
  gaps: string[];
  scamDetection: { isScam: boolean; reason: string; salaryRange: string };
  questions: string[];
  insights: {
    careerGrowth: { score: number; reason: string };
    techModernity: { score: number; reason: string };
    learningOpportunities: string;
    workLifeBalance: string;
    cultureFit: string;
  };
}

export interface QuizData {
  job_context: string;
  multiple_choice: Array<{
    question_number: number;
    question: string;
    options: { A: string; B: string; C: string; D: string };
    correct_answer: string;
    difficulty: string;
    explanation: string;
    relevant_skill: string;
  }>;
  essay: Array<{
    question_number: number;
    question: string;
    difficulty: string;
    expected_points: string[];
    relevant_skill: string;
  }>;
}

export interface LearningPath {
  total_hours: number;
  paths: Array<{
    path_number: number;
    skill_gap: string;
    topic: string;
    description: string;
    estimated_hours: number;
    difficulty: string;
    resources: Array<{
      type: string;
      title: string;
      url?: string;
      platform?: string;
      description?: string;
    }>;
  }>;
}

export interface CVPreview {
  has_cv: boolean;
  filename: string;
  text_preview: string;
  text_length: number;
  uploaded_at: string;
  credits_remaining: number;
  // v2: Blob Storage PNG preview
  blob_url: string;
  page_images: string[];
}

export type InterviewLanguage = 'id' | 'en' | 'zh';
export type InterviewMode = 'text' | 'speech';

export interface InterviewStartResponse {
  sessionId: string;
  assistantResponse: string;
  turnCount: number;
  maxQuestions?: number;
  sessionCost?: number;
  credits_remaining: number;
  plan?: 'free' | 'basic' | 'pro' | 'admin';
  quality?: 'lite' | 'deep';
  speechEnabled?: boolean;
}

export interface InterviewTurnResponse {
  assistantResponse: string;
  turnCount: number;
  maxQuestions?: number;
  completed?: boolean;
  cached: boolean;
}

export interface InterviewEndResponse {
  sessionId: string;
  summary: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  role: 'admin' | 'user';
  plan?: 'free' | 'basic' | 'pro' | 'admin';
  testing_plan_override?: 'free' | 'basic' | 'pro' | 'admin' | null;
  plan_expires_at?: string | null;
  credits_remaining: number;
  is_banned?: boolean;
  banned_reason?: string;
  created_at?: string;
  last_activity_at?: string;
}

export interface AdminOverview {
  total_users: number;
  banned_users: number;
  active_last_7_days: number;
  testing_plan_override?: 'free' | 'basic' | 'pro' | 'admin' | null;
  effective_plan?: 'free' | 'basic' | 'pro' | 'admin';
  most_used_feature?: { feature: string; count: number } | null;
  least_used_feature?: { feature: string; count: number } | null;
}

export interface AdminResetUsersResult {
  ok: boolean;
  updated_count: number;
  trial_days: number;
  plan: 'pro';
  expires_at: string;
  credits_cap: number;
}

export interface AdminTestingPlanResult {
  target_user_id: string;
  testing_plan_override?: 'free' | 'basic' | 'pro' | 'admin' | null;
  effective_plan: 'free' | 'basic' | 'pro' | 'admin';
  credits_remaining: number;
}

export interface AdminActivitySummary {
  usage: Array<{ feature: string; count: number }>;
  most_used?: { feature: string; count: number } | null;
  least_used?: { feature: string; count: number } | null;
}

// ═══════════════════════════════════════════════════
// API Endpoints
// ═══════════════════════════════════════════════════

/** GET /api/user-stats */
export const getUserStats = () =>
  fetchApi<UserStats>('/api/user-stats', 'GET');

/** GET /api/history */
export const getAnalysisHistory = (limit = 10, offset = 0) =>
  fetchApi<Array<{
    id: string; jobTitle: string; portal: string;
    matchScore: number; created_at: string; gaps: string[];
    has_quiz: boolean; has_learning_path: boolean;
  }>>(`/api/history?limit=${limit}&offset=${offset}`, 'GET');

/** DELETE /api/history */
export const deleteAnalysisHistory = (analysisId: string) =>
  fetchApi<{ message: string; deleted: { analysis: number; chats: number; activity: number }; analysisId: string }>(
    '/api/history',
    'DELETE',
    { analysisId }
  );

/** POST /api/analyze */
export const analyzeJob = (jobDescription: string, jobTitle?: string, portal?: string, model?: string) =>
  fetchApi<{ analysis: AnalysisResult; analysis_id: string; credits_remaining: number }>(
    '/api/analyze', 'POST', { jobDescription, jobTitle, portal, model }
  );

/** POST /api/chat — Chat with Ujang HR AI */
export const chatWithUjang = (
  message: string,
  analysisId?: string,
  conversationHistory?: Array<{ role: string; content: string }>
) =>
  fetchApi<{ response: string; credits_remaining: number }>(
    '/api/chat', 'POST', { message, analysisId, conversationHistory }
  );

/** POST /api/generate-quiz */
export const generateQuiz = (analysisId: string) =>
  fetchApi<{ quiz: QuizData; analysis_id: string; credits_remaining: number; cached?: boolean; cache_source?: string }>(
    '/api/generate-quiz', 'POST', { analysisId }
  );

/** POST /api/quiz-submit */
export const submitQuiz = (
  analysisId: string,
  answers: { multiple_choice: Record<string, string>; essay: Record<string, string> }
) =>
  fetchApi<{
    results: {
      multiple_choice_score: number;
      multiple_choice_total: number;
      multiple_choice_details: Array<{
        question_number: number; user_answer: string;
        correct_answer: string; is_correct: boolean; explanation: string;
      }>;
      essay_feedback: Array<{ question_number: number; score: number; feedback: string }>;
      overall_score: number;
      passed: boolean;
    };
    credits_remaining: number;
  }>('/api/quiz-submit', 'POST', { analysisId, answers });

/** POST /api/generate-learning-path */
export const generateLearningPath = (analysisId: string) =>
  fetchApi<{ learning_path: LearningPath; analysis_id: string; credits_remaining: number }>(
    '/api/generate-learning-path', 'POST', { analysisId }
  );

/** POST /api/upload-cv — Upload/replace CV (1 per user)
 * Supports two modes:
 * - pdfBase64: full pipeline (PDF → PNG pages → Blob Storage)
 * - cvText: legacy text-only (ATS Builder)
 */
export const uploadCV = (cvText: string, filename: string) =>
  fetchApi<{ message: string; filename: string; text_length: number; credits_remaining: number }>(
    '/api/upload-cv', 'POST', { cvText, filename }
  );

/** POST /api/upload-cv — Upload PDF binary as base64 for full PNG preview pipeline */
export const uploadCVPdf = (pdfBase64: string, filename: string) =>
  fetchApi<{
    message: string;
    filename: string;
    text_length: number;
    pages: number;
    blob_url: string;
    page_images: string[];
    credits_remaining: number;
  }>('/api/upload-cv', 'POST', { pdfBase64, filename });

/** GET /api/upload-cv — Preview user's CV */
export const getCVPreview = () =>
  fetchApi<CVPreview>('/api/upload-cv', 'GET');

/** DELETE /api/upload-cv — Delete user's CV */
export const deleteCV = () =>
  fetchApi<{ message: string; credits_remaining: number }>('/api/upload-cv', 'DELETE');

/** POST /api/interview-lite — Start interview session (cost: 3 credits once per session) */
export const startInterviewLite = (analysisId: string, language: InterviewLanguage, mode: InterviewMode) =>
  fetchApi<InterviewStartResponse>('/api/interview-lite', 'POST', {
    action: 'start',
    analysisId,
    language,
    mode,
  });

/** POST /api/interview-lite — Process one turn */
export const turnInterviewLite = (sessionId: string, answerText: string) =>
  fetchApi<InterviewTurnResponse>('/api/interview-lite', 'POST', {
    action: 'turn',
    sessionId,
    answerText,
  });

/** POST /api/interview-lite — End session and get summary */
export const endInterviewLite = (sessionId: string) =>
  fetchApi<InterviewEndResponse>('/api/interview-lite', 'POST', {
    action: 'end',
    sessionId,
  });

/** POST /api/interview-lite — Speech to Text: sends audioBase64 + contentType, returns transcriptText */
export const sttInterviewLite = (audioBase64: string, language: InterviewLanguage, contentType?: string) =>
  fetchApi<{ transcriptText: string }>('/api/interview-lite', 'POST', {
    action: 'stt',
    audioBase64,
    language,
    contentType,
  });

/** POST /api/interview-lite — Text to Speech: sends text, returns audioBase64 + outputFormat */
export const ttsInterviewLite = (text: string, language: InterviewLanguage) =>
  fetchApi<{ audioBase64: string; outputFormat: string }>('/api/interview-lite', 'POST', {
    action: 'tts',
    text,
    language,
  });

/** GET /api/admincenter?action=overview */
export const getAdminOverview = () =>
  fetchApi<AdminOverview>('/api/admincenter?action=overview', 'GET');

/** GET /api/admincenter?action=users */
export const getAdminUsers = (search = '', limit = 30) =>
  fetchApi<{ users: AdminUserRow[] }>(
    `/api/admincenter?action=users&search=${encodeURIComponent(search)}&limit=${limit}`,
    'GET'
  );

/** GET /api/admincenter?action=activity */
export const getAdminActivity = () =>
  fetchApi<AdminActivitySummary>('/api/admincenter?action=activity', 'GET');

/** POST /api/user-stats action=ban-user */
export const adminSetUserBan = (targetUserId: string, banned: boolean, reason?: string) =>
  fetchApi<{ ok: boolean; targetUserId: string; banned: boolean }>('/api/user-stats', 'POST', {
    action: 'ban-user',
    targetUserId,
    banned,
    reason,
  });

/** POST /api/user-stats action=add-credits */
export const adminAddUserCredits = (targetUserId: string, amount: number) =>
  fetchApi<{ target_user_id: string; credits_remaining: number; added?: number; skipped?: boolean; reason?: string }>(
    '/api/user-stats',
    'POST',
    {
      action: 'add-credits',
      targetUserId,
      amount,
    }
  );

/** POST /api/admincenter action=set-testing-plan */
export const adminSetTestingPlan = (testingPlan: 'free' | 'basic' | 'pro' | 'admin' | 'off', targetUserId?: string) =>
  fetchApi<AdminTestingPlanResult>('/api/admincenter', 'POST', {
    action: 'set-testing-plan',
    targetUserId,
    testingPlan,
  });

export interface AdminSetUserPlanResult {
  target_user_id: string;
  plan: 'free' | 'basic' | 'pro';
  plan_expires_at: string | null;
  credits_remaining: number;
}

/** POST /api/admincenter action=set-user-plan */
export const adminSetUserPlan = (targetUserId: string, plan: 'free' | 'basic' | 'pro', trialDays = 30) =>
  fetchApi<AdminSetUserPlanResult>('/api/admincenter', 'POST', {
    action: 'set-user-plan',
    targetUserId,
    plan,
    trialDays,
  });

/** POST /api/user-stats action=reset-non-admin-users */
export const adminResetNonAdminUsers = (trialDays = 7) =>
  fetchApi<AdminResetUsersResult>('/api/user-stats', 'POST', {
    action: 'reset-non-admin-users',
    confirm: 'RESET_NON_ADMIN_USERS',
    trialDays,
  });

// ═══════════════════════════════════════════════════
// Payment
// ═══════════════════════════════════════════════════

export interface PlanInfo {
  id: 'free' | 'basic' | 'pro';
  name: string;
  price: number;
  price_label: string;
  subtitle: string;
  features: string[];
  highlighted?: boolean;
}

export interface PaymentStatus {
  current_plan: 'free' | 'basic' | 'pro' | 'admin';
  plan_expires_at?: string | null;
  is_admin: boolean;
  available_plans: PlanInfo[];
}

export interface CreateTransactionResult {
  checkout_url?: string;
  transaction_id?: string;
  plan: string;
  amount: number;
  payment_type?: string;
  payment_number?: string;
  qr_string?: string;
  actions?: Array<{ name?: string; method?: string; url?: string }>;
}

/** GET /api/payment — get current plan & available plans */
export const getPaymentStatus = () =>
  fetchApi<PaymentStatus>('/api/payment', 'GET');

/** POST /api/payment action=create — create checkout transaction */
export const createPaymentTransaction = (
  plan: 'basic' | 'pro',
  successUrl?: string,
  cancelUrl?: string,
  paymentType: 'qris' | 'gopay' = 'qris'
) =>
  fetchApi<CreateTransactionResult>('/api/payment', 'POST', {
    action: 'create',
    plan,
    paymentType,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
