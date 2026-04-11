import { supabase } from './supabase';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });

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

  return response.json();
};

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface UserStats {
  credits_remaining: number;
  max_credits: number | string;
  role: 'admin' | 'user';
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
  fetchApi<{ quiz: QuizData; analysis_id: string; credits_remaining: number }>(
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
