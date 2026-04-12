"""
Azure Function: AI Interview Lite
POST /api/interview-lite
Actions:
- start: create session + deduct 3 credits + generate first FAANG-style question
- turn: process one user answer turn with queue lock + short response cache
- end: finish session and return a concise summary
"""
import hashlib
import os
import base64
from datetime import datetime, timedelta

import azure.functions as func
import requests

from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import (
    check_and_regen_credits,
    deduct_credits,
    get_container,
    get_secret,
    is_allowed_admin_email,
    get_effective_plan,
)
from shared.llm_service import call_llm, MODEL_GEMINI_FLASH, MODEL_GEMINI_PRO, MODEL_GEMINI_3_PRO

try:
    import redis
except Exception:  # pragma: no cover
    redis = None

TEXT_SESSION_COST = int(os.environ.get("INTERVIEW_TEXT_SESSION_COST", "2"))
SPEECH_SESSION_COST = int(os.environ.get("INTERVIEW_SPEECH_SESSION_COST", "3"))
MAX_QUESTIONS_PER_SESSION = int(os.environ.get("INTERVIEW_MAX_QUESTIONS", "5"))
LOCK_TTL_SEC = int(os.environ.get("INTERVIEW_LOCK_TTL_SEC", "30"))
TURN_CACHE_TTL_SEC = int(os.environ.get("INTERVIEW_TURN_CACHE_TTL_SEC", "600"))
MAX_TURNS = int(os.environ.get("INTERVIEW_MAX_TURNS", "12"))
START_RATE_LIMIT_WINDOW_SEC = int(os.environ.get("INTERVIEW_START_RATE_LIMIT_WINDOW_SEC", "600"))
START_RATE_LIMIT_MAX_REQUESTS = int(os.environ.get("INTERVIEW_START_RATE_LIMIT_MAX_REQUESTS", "3"))
TURN_RATE_LIMIT_WINDOW_SEC = int(os.environ.get("INTERVIEW_TURN_RATE_LIMIT_WINDOW_SEC", "60"))
TURN_RATE_LIMIT_MAX_REQUESTS = int(os.environ.get("INTERVIEW_TURN_RATE_LIMIT_MAX_REQUESTS", "20"))
SPEECH_STT_MAX_AUDIO_BYTES = int(os.environ.get("AZURE_SPEECH_STT_MAX_AUDIO_BYTES", str(5 * 1024 * 1024)))
SPEECH_TTS_OUTPUT_FORMAT = os.environ.get("AZURE_SPEECH_TTS_OUTPUT_FORMAT", "audio-16khz-32kbitrate-mono-mp3")
SPEECH_STT_CONTENT_TYPE = os.environ.get("AZURE_SPEECH_STT_CONTENT_TYPE", "audio/wav")

LANGUAGE_HINT = {
    "id": "Respond in Bahasa Indonesia.",
    "en": "Respond in English.",
    "zh": "Respond in Simplified Chinese.",
}

MODE_HINT = {
    "text": "Mode is text-to-text. Keep structured, concise output.",
    "speech": "Mode is speech-to-speech. Keep spoken-friendly concise output.",
}

LANGUAGE_TO_LOCALE = {
    "id": "id-ID",
    "en": "en-US",
    "zh": "zh-CN",
}

LANGUAGE_TO_VOICE = {
    "id": os.environ.get("AZURE_SPEECH_TTS_VOICE_ID", "id-ID-GadisNeural"),
    "en": os.environ.get("AZURE_SPEECH_TTS_VOICE_EN", "en-US-JennyNeural"),
    "zh": os.environ.get("AZURE_SPEECH_TTS_VOICE_ZH", "zh-CN-XiaoxiaoNeural"),
}

DEFAULT_PLAN = os.environ.get("INTERVIEW_DEFAULT_PLAN", "free").strip().lower() or "free"

INTERVIEW_PROFILE = {
    "free": {
        "quality": "lite",
        "max_questions": 3,
        "max_turns": 7,
        "question_max_tokens": 240,
        "summary_max_tokens": 260,
        "speech_enabled": False,
        "text_cost": max(1, TEXT_SESSION_COST),
        "speech_cost": max(2, SPEECH_SESSION_COST),
        "model": MODEL_GEMINI_FLASH,
    },
    "basic": {
        "quality": "lite",
        "max_questions": 5,
        "max_turns": 12,
        "question_max_tokens": 360,
        "summary_max_tokens": 420,
        "speech_enabled": False,
        "text_cost": max(1, TEXT_SESSION_COST),
        "speech_cost": max(2, SPEECH_SESSION_COST),
        "model": MODEL_GEMINI_FLASH,
    },
    "pro": {
        "quality": "deep",
        "max_questions": 8,
        "max_turns": 18,
        "question_max_tokens": 780,
        "summary_max_tokens": 700,
        "speech_enabled": True,
        "text_cost": max(1, TEXT_SESSION_COST),
        "speech_cost": max(2, SPEECH_SESSION_COST),
        "model": MODEL_GEMINI_PRO,
    },
    "admin": {
        "quality": "deep",
        "max_questions": 8,
        "max_turns": 20,
        "question_max_tokens": 900,
        "summary_max_tokens": 700,
        "speech_enabled": True,
        "text_cost": 0,
        "speech_cost": 0,
        "model": MODEL_GEMINI_3_PRO,
    },
}


def _normalize_plan(value: str) -> str:
    p = (value or "").strip().lower()
    if p in INTERVIEW_PROFILE:
        return p
    return DEFAULT_PLAN if DEFAULT_PLAN in INTERVIEW_PROFILE else "free"


def _is_admin_user(user_doc: dict, email: str = "") -> bool:
    role_admin = str(user_doc.get("role") or "").strip().lower() == "admin"
    user_email = str(user_doc.get("email") or email or "").strip().lower().replace(" ", "")
    return bool(role_admin or is_allowed_admin_email(user_email))


def _resolve_interview_profile(user_doc: dict, email: str = ""):
    if _is_admin_user(user_doc, email):
        return INTERVIEW_PROFILE["admin"], "admin", True

    effective_plan = get_effective_plan(user_doc)
    plan = _normalize_plan(effective_plan if effective_plan != "admin" else DEFAULT_PLAN)
    profile = INTERVIEW_PROFILE.get(plan, INTERVIEW_PROFILE["basic"])
    return profile, plan, False


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat()


def _redis_client():
    if redis is None:
        return None

    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        try:
            return redis.Redis.from_url(redis_url, decode_responses=True)
        except Exception:
            return None

    host = os.environ.get("REDIS_HOST")
    key = os.environ.get("REDIS_KEY")
    if not host or not key:
        return None

    try:
        return redis.Redis(
            host=host,
            port=int(os.environ.get("REDIS_PORT", "6380")),
            password=key,
            ssl=True,
            decode_responses=True,
        )
    except Exception:
        return None


def _normalize_text(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _hash_turn(session_id: str, answer_text: str) -> str:
    payload = f"{session_id}|{_normalize_text(answer_text)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_system_prompt(language: str, mode: str, context: str, max_questions: int, quality: str) -> str:
    lang_hint = LANGUAGE_HINT.get(language, LANGUAGE_HINT["id"])
    mode_hint = MODE_HINT.get(mode, MODE_HINT["text"])
    depth_instruction = (
        "Keep feedback concise and practical. Avoid over-long explanations."
        if quality == "lite"
        else "Deliver deep technical follow-ups with stronger rationale and trade-off framing."
    )
    return (
        "You are FYJOB Interview Lite. Ask technical interview questions only (no behavioral questions). "
        f"The total interview has exactly {max_questions} technical questions. "
        "At interview start, return this exact format:\n"
        "**Pertanyaan Interview:** [question text]\n"
        "**Petunjuk Jawaban Kuat:** [hint for a strong answer]\n\n"
        "After the candidate answers, first evaluate their answer briefly, then ask the next question with this exact format:\n"
        "**Evaluasi Jawaban:** [brief evaluation of strengths and misses]\n"
        "**Tindak Lanjut:** [one short practical improvement tip]\n"
        "**Pertanyaan Interview:** [next technical question]\n"
        "**Petunjuk Jawaban Kuat:** [hint for a strong answer]\n\n"
        "Each question must be specific to the user's CV + selected analysis context and feel like real engineering interview drills.\n"
        f"{depth_instruction}\n"
        f"{lang_hint}\n"
        f"{mode_hint}\n"
        "Candidate context:\n"
        f"{context}"
    )


def _session_cost_by_mode(mode: str, profile: dict) -> int:
    if (mode or "").strip().lower() == "speech":
        return int(profile.get("speech_cost", max(0, SPEECH_SESSION_COST)))
    return int(profile.get("text_cost", max(0, TEXT_SESSION_COST)))


def _load_analysis_context(user_id: str, analysis_id: str, user_doc: dict) -> str:
    history_container = get_container("AnalysisHistory")
    analysis = history_container.read_item(item=analysis_id, partition_key=user_id)

    if analysis.get("userId") != user_id:
        raise RuntimeError("Analysis not found")

    cv_text = (user_doc.get("raw_cv_text") or "")[:1800]
    gaps = ", ".join(analysis.get("gaps", []))
    return (
        f"Job Title: {analysis.get('jobTitle', 'Unknown')}\n"
        f"Portal: {analysis.get('portal', 'Unknown')}\n"
        f"Match Score: {analysis.get('matchScore', 'N/A')}\n"
        f"Skill Gaps: {gaps}\n"
        f"Job Description (trimmed): {(analysis.get('jobDescription', '') or '')[:1800]}\n"
        f"Candidate CV (trimmed): {cv_text}"
    )


def _count_recent_sessions(sessions, user_id: str, seconds: int) -> int:
    window_start = (datetime.utcnow() - timedelta(seconds=seconds)).isoformat()
    query = (
        "SELECT VALUE COUNT(1) FROM c "
        "WHERE c.userId = @uid AND c.started_at >= @window_start"
    )
    params = [
        {"name": "@uid", "value": user_id},
        {"name": "@window_start", "value": window_start},
    ]
    rows = list(
        sessions.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=False,
            partition_key=user_id,
        )
    )
    return int(rows[0]) if rows else 0


def _count_recent_turns(sessions, user_id: str, seconds: int) -> int:
    window_start = (datetime.utcnow() - timedelta(seconds=seconds)).isoformat()
    query = (
        "SELECT VALUE COUNT(1) FROM c JOIN m IN c.messages "
        "WHERE c.userId = @uid AND m.role = 'user' AND m.ts >= @window_start"
    )
    params = [
        {"name": "@uid", "value": user_id},
        {"name": "@window_start", "value": window_start},
    ]
    rows = list(
        sessions.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=False,
            partition_key=user_id,
        )
    )
    return int(rows[0]) if rows else 0


def _get_speech_credentials():
    speech_key = (
        os.environ.get("AZURE_SPEECH_KEY")
        or get_secret("azure-speech-key")
        or get_secret("AZURE_SPEECH_KEY")
    )
    speech_region = (
        os.environ.get("AZURE_SPEECH_REGION")
        or get_secret("azure-speech-region")
        or get_secret("AZURE_SPEECH_REGION")
        or "eastus"
    )

    if not speech_key or not speech_key.strip():
        raise ValueError(
            "Azure Speech Key is not configured. "
            "Set AZURE_SPEECH_KEY in Function App settings via: "
            "az functionapp config appsettings set --name fypodku --resource-group FYPOD --settings AZURE_SPEECH_KEY=<key>"
        )

    return speech_key.strip(), speech_region.strip()


def _decode_audio_base64(audio_base64: str) -> bytes:
    try:
        audio_bytes = base64.b64decode(audio_base64, validate=True)
    except Exception:
        raise ValueError("Invalid audioBase64 payload")

    if not audio_bytes:
        raise ValueError("audioBase64 is empty")
    if len(audio_bytes) > SPEECH_STT_MAX_AUDIO_BYTES:
        raise ValueError("audioBase64 payload too large")

    return audio_bytes


def _speech_to_text(audio_base64: str, language: str, content_type: str = None):
    speech_key, speech_region = _get_speech_credentials()
    locale = LANGUAGE_TO_LOCALE.get(language, LANGUAGE_TO_LOCALE["id"])
    audio_bytes = _decode_audio_base64(audio_base64)

    endpoint = (
        f"https://{speech_region}.stt.speech.microsoft.com"
        "/speech/recognition/conversation/cognitiveservices/v1"
    )

    stt_content_type = (content_type or SPEECH_STT_CONTENT_TYPE or "audio/wav").strip()

    response = requests.post(
        endpoint,
        params={"language": locale, "format": "simple"},
        headers={
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": stt_content_type,
            "Accept": "application/json",
        },
        data=audio_bytes,
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(f"Azure Speech STT failed: {response.status_code}")

    payload = response.json()
    transcript = (payload.get("DisplayText") or "").strip()
    if not transcript:
        recognition_status = payload.get("RecognitionStatus") or "Unknown"
        raise ValueError(
            f"No transcript recognized. status={recognition_status}. "
            "Please speak longer/clearer and try again."
        )

    return transcript


def _text_to_speech(text: str, language: str):
    speech_key, speech_region = _get_speech_credentials()
    locale = LANGUAGE_TO_LOCALE.get(language, LANGUAGE_TO_LOCALE["id"])
    voice = LANGUAGE_TO_VOICE.get(language, LANGUAGE_TO_VOICE["id"])

    clean_text = (text or "").strip()
    if not clean_text:
        raise ValueError("text is required for tts")

    endpoint = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    ssml = (
        f"<speak version='1.0' xml:lang='{locale}'>"
        f"<voice xml:lang='{locale}' name='{voice}'>{clean_text}</voice>"
        "</speak>"
    )

    response = requests.post(
        endpoint,
        headers={
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": SPEECH_TTS_OUTPUT_FORMAT,
            "User-Agent": "fyjob-interview-lite",
        },
        data=ssml.encode("utf-8"),
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(f"Azure Speech TTS failed: {response.status_code}")

    audio_base64 = base64.b64encode(response.content).decode("utf-8")
    return audio_base64


def _stt_action(user_id: str, email: str, body: dict):
    user = check_and_regen_credits(user_id, email)
    profile, _plan, is_admin = _resolve_interview_profile(user, email)
    if not is_admin and not bool(profile.get("speech_enabled", False)):
        return error_response("Speech mode is available for Pro plan only", 403)

    audio_base64 = body.get("audioBase64")
    language = body.get("language", "id")
    content_type = body.get("contentType")
    if not audio_base64:
        return error_response("audioBase64 is required", 400)

    try:
        transcript = _speech_to_text(audio_base64, language, content_type=content_type)
    except ValueError as e:
        return error_response(str(e), 400)
    except Exception as e:
        return error_response(str(e), 502)

    return success_response({"transcriptText": transcript})


def _tts_action(user_id: str, email: str, body: dict):
    user = check_and_regen_credits(user_id, email)
    profile, _plan, is_admin = _resolve_interview_profile(user, email)
    if not is_admin and not bool(profile.get("speech_enabled", False)):
        return error_response("Speech mode is available for Pro plan only", 403)

    text = body.get("text")
    language = body.get("language", "id")
    if not text:
        return error_response("text is required", 400)

    try:
        audio_base64 = _text_to_speech(text, language)
    except ValueError as e:
        return error_response(str(e), 400)
    except Exception as e:
        return error_response(str(e), 502)

    return success_response(
        {
            "audioBase64": audio_base64,
            "outputFormat": SPEECH_TTS_OUTPUT_FORMAT,
        }
    )


def _start_session(user_id: str, email: str, body: dict):
    analysis_id = body.get("analysisId")
    language = body.get("language", "id")
    mode = body.get("mode", "text")

    if not analysis_id:
        return error_response("analysisId is required", 400)

    sessions = get_container("InterviewSessions")

    user = check_and_regen_credits(user_id, email)
    if not user.get("raw_cv_text"):
        return error_response("CV is not uploaded yet. Please upload your CV in CV Manager first.", 403)

    profile, plan, is_admin = _resolve_interview_profile(user, email)

    if mode == "speech" and not is_admin and not bool(profile.get("speech_enabled", False)):
        return error_response("Speech mode is available for Pro plan only", 403)

    max_questions = int(profile.get("max_questions", MAX_QUESTIONS_PER_SESSION))
    max_turns = int(profile.get("max_turns", MAX_TURNS))
    model_to_use = profile.get("model", MODEL_GEMINI_FLASH)
    question_max_tokens = int(profile.get("question_max_tokens", 500))
    summary_max_tokens = int(profile.get("summary_max_tokens", 450))
    quality_mode = str(profile.get("quality", "lite"))

    session_cost = _session_cost_by_mode(mode, profile)

    if not is_admin and int(user.get("credits_remaining", 0)) < session_cost:
        return error_response("Insufficient credits for interview session", 403)

    try:
        context = _load_analysis_context(user_id, analysis_id, user)
    except Exception:
        return error_response("Analysis not found", 404)

    if not is_admin:
        try:
            recent_session_count = _count_recent_sessions(sessions, user_id, START_RATE_LIMIT_WINDOW_SEC)
            if recent_session_count >= START_RATE_LIMIT_MAX_REQUESTS:
                return error_response("Terlalu banyak memulai sesi interview. Coba lagi beberapa menit lagi.", 429)
        except Exception:
            pass

    system_prompt = _build_system_prompt(language, mode, context, max_questions=max_questions, quality=quality_mode)
    first_turn = call_llm(
        [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"Start technical question 1/{max_questions} now. "
                    "Use the required output format exactly."
                ),
            },
        ],
        model=model_to_use,
        max_tokens=question_max_tokens,
        temperature=0.6,
    )

    if not first_turn or not first_turn.strip():
        return error_response("Failed to generate first interview question", 500)

    session_id = f"interview_{user_id}_{datetime.utcnow().timestamp()}"
    now = _utc_now_iso()

    session_doc = {
        "id": session_id,
        "userId": user_id,
        "analysisId": analysis_id,
        "language": language,
        "mode": mode,
        "status": "active",
        "credits_charged": session_cost,
        "started_at": now,
        "updated_at": now,
        "ended_at": None,
        "turn_count": 1,
        "plan": plan,
        "quality": quality_mode,
        "max_questions": max_questions,
        "max_turns": max_turns,
        "model": model_to_use,
        "question_max_tokens": question_max_tokens,
        "summary_max_tokens": summary_max_tokens,
        "messages": [
            {"role": "assistant", "content": first_turn, "ts": now},
        ],
    }

    sessions.upsert_item(session_doc)

    remaining = int(user.get("credits_remaining", 0))
    if not is_admin:
        remaining = deduct_credits(user_id, session_cost)

    r = _redis_client()
    if r:
        try:
            r.setex(f"fyjob:interview:session:{session_id}", 86400, first_turn)
        except Exception:
            pass

    return success_response(
        {
            "sessionId": session_id,
            "assistantResponse": first_turn,
            "turnCount": 1,
            "maxQuestions": max_questions,
            "sessionCost": session_cost,
            "credits_remaining": remaining,
            "plan": plan,
            "quality": quality_mode,
            "speechEnabled": bool(profile.get("speech_enabled", False)),
        }
    )


def _turn_session(user_id: str, email: str, body: dict):
    session_id = body.get("sessionId")
    answer_text = (body.get("answerText") or body.get("transcriptText") or "").strip()

    if not session_id:
        return error_response("sessionId is required", 400)
    if not answer_text:
        return error_response("answerText/transcriptText is required", 400)

    user = check_and_regen_credits(user_id, email)
    _profile, _plan, is_admin = _resolve_interview_profile(user, email)
    sessions = get_container("InterviewSessions")

    try:
        session = sessions.read_item(item=session_id, partition_key=user_id)
    except Exception:
        return error_response("Session not found", 404)

    if not is_admin:
        try:
            recent_turn_count = _count_recent_turns(sessions, user_id, TURN_RATE_LIMIT_WINDOW_SEC)
            if recent_turn_count >= TURN_RATE_LIMIT_MAX_REQUESTS:
                return error_response("Terlalu banyak turn interview. Coba lagi sebentar.", 429)
        except Exception:
            pass

    if session.get("status") != "active":
        return error_response("Session is not active", 400)

    session_max_questions = int(session.get("max_questions", MAX_QUESTIONS_PER_SESSION))
    session_max_turns = int(session.get("max_turns", MAX_TURNS))
    session_model = session.get("model", MODEL_GEMINI_FLASH)
    session_question_max_tokens = int(session.get("question_max_tokens", 500))
    session_quality = str(session.get("quality", "lite"))

    if int(session.get("turn_count", 0)) > session_max_questions:
        return error_response("Question limit reached. End this session and start a new one.", 400)

    if not is_admin and int(session.get("turn_count", 0)) >= session_max_turns:
        return error_response("Max turns reached. End this session and start a new one.", 400)

    r = _redis_client()
    lock_key = f"fyjob:interview:lock:{session_id}"
    lock_token = hashlib.md5(f"{session_id}-{datetime.utcnow().timestamp()}".encode("utf-8")).hexdigest()

    lock_ok = True
    if r:
        try:
            lock_ok = bool(r.set(lock_key, lock_token, nx=True, ex=LOCK_TTL_SEC))
        except Exception:
            lock_ok = True

    if not lock_ok:
        return error_response("Another interview turn is processing. Please retry.", 409)

    try:
        turn_hash = _hash_turn(session_id, answer_text)
        if r:
            try:
                cached = r.get(f"fyjob:interview:turncache:{session_id}:{turn_hash}")
                if cached:
                    return success_response(
                        {
                            "assistantResponse": cached,
                            "turnCount": session.get("turn_count", 1),
                            "maxQuestions": session_max_questions,
                            "completed": session.get("status") == "completed",
                            "cached": True,
                        }
                    )
            except Exception:
                pass

        now = _utc_now_iso()
        current_question = int(session.get("turn_count", 1))
        history = session.get("messages", [])

        # If user just answered the final question, close question flow without generating question 6.
        if current_question >= session_max_questions:
            assistant_text = (
                f"**Pertanyaan Interview:** Sesi technical interview selesai ({session_max_questions}/{session_max_questions}).\n"
                "**Petunjuk Jawaban Kuat:** Klik End Interview untuk melihat ringkasan kekuatan, gap, dan next action Anda."
            )
            history.extend(
                [
                    {"role": "user", "content": answer_text, "ts": now},
                    {"role": "assistant", "content": assistant_text, "ts": now},
                ]
            )
            session["messages"] = history
            session["updated_at"] = now
            session["status"] = "completed"
            sessions.upsert_item(session)

            if r:
                try:
                    r.setex(f"fyjob:interview:turncache:{session_id}:{turn_hash}", TURN_CACHE_TTL_SEC, assistant_text)
                except Exception:
                    pass

            return success_response(
                {
                    "assistantResponse": assistant_text,
                    "turnCount": current_question,
                    "maxQuestions": session_max_questions,
                    "cached": False,
                    "completed": True,
                }
            )

        context = _load_analysis_context(user_id, session.get("analysisId"), user)
        system_prompt = _build_system_prompt(
            session.get("language", "id"),
            session.get("mode", "text"),
            context,
            max_questions=session_max_questions,
            quality=session_quality,
        )

        next_question = current_question + 1
        messages = [{"role": "system", "content": system_prompt}]
        for m in history[-12:]:
            role = "assistant" if m.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": m.get("content", "")})
        messages.append(
            {
                "role": "user",
                "content": (
                    f"My previous answer: {answer_text}\n"
                    "First evaluate my answer briefly and concretely. "
                    f"Then ask technical question {next_question}/{session_max_questions}. "
                    "Use the required output format exactly."
                ),
            }
        )

        assistant_text = call_llm(
            messages,
            model=session_model,
            max_tokens=session_question_max_tokens,
            temperature=0.6,
        )
        if not assistant_text or not assistant_text.strip():
            assistant_text = (
                "**Evaluasi Jawaban:** Jawaban Anda sudah punya arah, tapi masih kurang detail teknis dan trade-off yang dipilih.\n"
                "**Tindak Lanjut:** Tambahkan alasan teknis, metrik hasil, dan risiko dari pendekatan Anda.\n"
                f"**Pertanyaan Interview:** Jelaskan bagaimana Anda memecah masalah teknis kompleks untuk pertanyaan {next_question}/{session_max_questions}.\n"
                "**Petunjuk Jawaban Kuat:** Gunakan struktur langkah, trade-off, dan metrik dampak."
            )

        history.extend(
            [
                {"role": "user", "content": answer_text, "ts": now},
                {"role": "assistant", "content": assistant_text, "ts": now},
            ]
        )
        session["messages"] = history
        session["updated_at"] = now
        session["turn_count"] = next_question
        sessions.upsert_item(session)

        if r:
            try:
                r.setex(f"fyjob:interview:turncache:{session_id}:{turn_hash}", TURN_CACHE_TTL_SEC, assistant_text)
            except Exception:
                pass

        return success_response(
            {
                "assistantResponse": assistant_text,
                "turnCount": session["turn_count"],
                "maxQuestions": session_max_questions,
                "cached": False,
            }
        )
    finally:
        if r:
            try:
                current = r.get(lock_key)
                if current == lock_token:
                    r.delete(lock_key)
            except Exception:
                pass


def _end_session(user_id: str, body: dict):
    session_id = body.get("sessionId")
    if not session_id:
        return error_response("sessionId is required", 400)

    sessions = get_container("InterviewSessions")
    try:
        session = sessions.read_item(item=session_id, partition_key=user_id)
    except Exception:
        return error_response("Session not found", 404)

    messages = session.get("messages", [])
    transcript = "\n".join([f"{m.get('role', '')}: {m.get('content', '')}" for m in messages[-20:]])

    summary_prompt = (
        "Evaluate this interview and return plain text only with this exact structure:\n"
        "Nilai Akhir: <0-100>\n"
        "Ringkasan Kinerja: <short paragraph>\n"
        "Area Perbaikan: <short paragraph>\n"
        "Solusi Tindak Lanjut: <short paragraph>\n"
        "Do not use markdown, bullets, asterisks, underscores, or special symbols."
    )

    summary = call_llm(
        [
            {"role": "system", "content": "You are a FAANG interview coach. Keep response concise."},
            {"role": "user", "content": f"{summary_prompt}\n\n{transcript}"},
        ],
        model=session.get("model", MODEL_GEMINI_FLASH),
        max_tokens=int(session.get("summary_max_tokens", 450)),
        temperature=0.4,
    )

    if not summary:
        summary = (
            "Nilai Akhir: 70\n"
            "Ringkasan Kinerja: Anda sudah menunjukkan dasar pemahaman teknis yang baik namun jawaban masih perlu lebih terstruktur.\n"
            "Area Perbaikan: Perjelas langkah solusi, trade off, dan metrik dampak pada tiap jawaban.\n"
            "Solusi Tindak Lanjut: Latih format jawaban langkah demi langkah, gunakan contoh nyata dari pengalaman, lalu evaluasi ulang dalam 3 hari."
        )

    def _sanitize_plain_text(value: str) -> str:
        lines = []
        for line in (value or "").splitlines():
            cleaned = line.replace("*", "").replace("_", "").replace("#", "")
            cleaned = cleaned.lstrip("- ").strip()
            if cleaned:
                lines.append(cleaned)
        return "\n".join(lines).strip()

    summary = _sanitize_plain_text(summary)

    score = 0
    for line in summary.splitlines():
        if line.lower().startswith("nilai akhir"):
            digits = "".join(ch for ch in line if ch.isdigit())
            if digits:
                score = max(0, min(100, int(digits)))
            break

    now = _utc_now_iso()
    session["status"] = "completed"
    session["ended_at"] = now
    session["updated_at"] = now
    session["summary"] = summary
    session["score"] = score
    sessions.upsert_item(session)

    return success_response({"sessionId": session_id, "summary": summary, "score": score})


def main(req: func.HttpRequest) -> func.HttpResponse:
    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        body = req.get_json()
    except Exception:
        body = {}

    action = (body.get("action") or "").strip().lower()
    if action == "start":
        return _start_session(user_id, email, body)
    if action == "turn":
        return _turn_session(user_id, email, body)
    if action == "end":
        return _end_session(user_id, body)
    if action == "stt":
        return _stt_action(user_id, email, body)
    if action == "tts":
        return _tts_action(user_id, email, body)

    return error_response("Invalid action. Use start, turn, end, stt, or tts.", 400)
