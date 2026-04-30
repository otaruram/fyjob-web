-- Supabase Schema for FYJOB (Document Store Model)

-- Drop existing tables if they have the wrong schema
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.analysis_history CASCADE;
DROP TABLE IF EXISTS public.ujang_chats CASCADE;
DROP TABLE IF EXISTS public.user_activity CASCADE;
DROP TABLE IF EXISTS public.interview_sessions CASCADE;
DROP TABLE IF EXISTS public.admin_audit_logs CASCADE;

-- 1. Users Table
CREATE TABLE public.users (
    id TEXT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users((data->>'email'));
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users((data->>'role'));
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON public.users((data->>'is_banned'));

-- 2. AnalysisHistory Table
CREATE TABLE IF NOT EXISTS public.analysis_history (
    id TEXT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analysis_user_id ON public.analysis_history((data->>'userId'));

-- 3. UjangChats Table
CREATE TABLE IF NOT EXISTS public.ujang_chats (
    id TEXT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.ujang_chats((data->>'userId'));
CREATE INDEX IF NOT EXISTS idx_chats_analysis_id ON public.ujang_chats((data->>'analysisId'));
CREATE INDEX IF NOT EXISTS idx_chats_prompt_key ON public.ujang_chats((data->>'prompt_key'));

-- 4. UserActivity Table
CREATE TABLE IF NOT EXISTS public.user_activity (
    id TEXT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id ON public.user_activity((data->>'userId'));

-- 5. InterviewSessions Table
CREATE TABLE IF NOT EXISTS public.interview_sessions (
    id TEXT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_interviews_user_id ON public.interview_sessions((data->>'userId'));

-- 6. AdminAuditLogs Table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id TEXT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_id ON public.admin_audit_logs((data->>'adminUserId'));

-- RLS Policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ujang_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service_role (backend)
