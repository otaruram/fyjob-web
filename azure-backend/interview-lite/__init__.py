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
import re
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
from shared.redis_cache import hash_text

try:
    import redis
except Exception:  # pragma: no cover
    redis = None

TEXT_SESSION_COST = max(1, int(os.environ.get("INTERVIEW_TEXT_SESSION_COST", "2")))
SPEECH_SESSION_COST = max(3, int(os.environ.get("INTERVIEW_SPEECH_SESSION_COST", "3")))
MAX_QUESTIONS_PER_SESSION = int(os.environ.get("INTERVIEW_MAX_QUESTIONS", "5"))
LOCK_TTL_SEC = int(os.environ.get("INTERVIEW_LOCK_TTL_SEC", "30"))
TURN_CACHE_TTL_SEC = int(os.environ.get("INTERVIEW_TURN_CACHE_TTL_SEC", "600"))
START_CACHE_TTL_SEC = int(os.environ.get("INTERVIEW_START_CACHE_TTL_SEC", "1800"))
SUMMARY_CACHE_TTL_SEC = int(os.environ.get("INTERVIEW_SUMMARY_CACHE_TTL_SEC", "1800"))
STT_CACHE_TTL_SEC = int(os.environ.get("INTERVIEW_STT_CACHE_TTL_SEC", "1800"))
TTS_CACHE_TTL_SEC = int(os.environ.get("INTERVIEW_TTS_CACHE_TTL_SEC", "7200"))
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


def _clean_interview_line(value: str) -> str:
    cleaned = (value or "").replace("\r", "\n")
    cleaned = re.sub(r"[*_#`~]+", "", cleaned)
    cleaned = cleaned.replace("•", " ")
    cleaned = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"^[\-:;,.\s]+", "", cleaned)
    return cleaned.strip()


def _split_points(value: str, max_points: int = 3):
    raw = (value or "").replace("\r", "\n")
    chunks = []
    for line in raw.splitlines():
        normalized = _clean_interview_line(line)
        if not normalized:
            continue
        parts = re.split(r"\s*[;|]\s*|(?<=[.!?])\s+(?=[A-Z0-9])", normalized)
        for part in parts:
            item = _clean_interview_line(part)
            if item:
                chunks.append(item)
            if len(chunks) >= max_points:
                return chunks[:max_points]
    return chunks[:max_points]


def _infer_role_family(context: str) -> str:
    lowered = (context or "").lower()
    role_keywords = {
        "housekeeping": ["housekeeping", "room attendant", "public area attendant", "cleaner", "cleaning service", "steward"],
        "admin": ["admin", "administrasi", "administration", "data entry", "office assistant", "secretary", "receptionist"],
        "cashier": ["cashier", "kasir", "point of sale", "pos", "payment counter"],
        "warehouse": ["warehouse", "gudang", "picker", "packer", "forklift", "inventory control", "logistics"],
    }
    for role_family, keywords in role_keywords.items():
        if any(keyword in lowered for keyword in keywords):
            return role_family
    return "general"


def _role_strictness_prompt(role_family: str) -> str:
    prompts = {
        "housekeeping": (
            "Be strict for housekeeping roles. Reject vague answers that do not mention SOP order, hygiene control, chemical safety, linen handling, contamination prevention, final room check, and readiness standard."
        ),
        "admin": (
            "Be strict for admin roles. Reject vague answers that do not mention document accuracy, filing flow, spreadsheet/system use, verification steps, deadline handling, escalation path, and error prevention."
        ),
        "cashier": (
            "Be strict for cashier roles. Reject vague answers that do not mention transaction accuracy, payment validation, counterfeit handling, shift reconciliation, POS procedure, customer queue handling, and cash discrepancy control."
        ),
        "warehouse": (
            "Be strict for warehouse roles. Reject vague answers that do not mention receiving/putaway/picking/packing flow, stock accuracy, barcode or scan discipline, FIFO/FEFO, safety rules, and mismatch handling."
        ),
    }
    return prompts.get(role_family, "Be strict. Reject generic answers that lack step-by-step process, accuracy checks, safety, and measurable output.")


def _role_specific_eval_points(role_family: str):
    defaults = {
        "housekeeping": [
            "Untuk role housekeeping, jawaban harus menyebut urutan SOP kerja, bahan yang dipakai, dan kontrol kebersihan. Jika itu tidak ada, jawaban masih lemah.",
            "Tekankan detail teknis seperti ventilasi, stripping linen, pembersihan bathroom, disinfeksi titik sentuh, dan final room inspection.",
        ],
        "admin": [
            "Untuk role admin, jawaban harus menunjukkan alur kerja yang rapi, teliti, dan bisa diaudit. Jika hanya umum, itu belum cukup.",
            "Jawaban perlu menyebut verifikasi data, pengecekan dokumen, prioritas deadline, dan cara mencegah salah input atau file hilang.",
        ],
        "cashier": [
            "Untuk role cashier, jawaban harus fokus pada akurasi transaksi dan kontrol selisih. Jawaban yang terlalu umum belum aman secara operasional.",
            "Sebut prosedur validasi pembayaran, penanganan uang tunai, pengecekan nominal, dan closing kas agar evaluasi dianggap kuat.",
        ],
        "warehouse": [
            "Untuk role warehouse, jawaban harus menjelaskan alur kerja fisik dengan disiplin proses. Jawaban umum tanpa urutan kerja belum layak.",
            "Sebut receiving, scanning, putaway, picking, packing, stock check, serta kontrol mismatch dan keselamatan kerja.",
        ],
        "general": [
            "Jawaban masih terlalu umum dan belum menunjukkan proses kerja yang bisa dieksekusi di lapangan.",
            "Perjelas langkah, kontrol risiko, dan standar hasil agar jawaban lebih meyakinkan.",
        ],
    }
    return defaults.get(role_family, defaults["general"])


def _role_specific_hint_points(role_family: str):
    hints = {
        "housekeeping": [
            "Jelaskan urutan SOP kerja dari awal sampai final check.",
            "Sebut bahan, alat, dan standar higienitas yang dipakai.",
            "Tutup dengan cara memastikan kamar siap dipakai tamu.",
        ],
        "admin": [
            "Susun alur kerja administrasi secara runtut dari input sampai arsip.",
            "Sebut langkah verifikasi untuk mencegah salah data atau dokumen tertukar.",
            "Jelaskan cara menjaga ketepatan waktu dan akurasi hasil.",
        ],
        "cashier": [
            "Jelaskan alur transaksi dari menerima pesanan sampai pembayaran selesai.",
            "Sebut langkah validasi nominal, metode bayar, dan bukti transaksi.",
            "Tutup dengan cara menangani selisih kas atau komplain pelanggan.",
        ],
        "warehouse": [
            "Jelaskan alur receiving, putaway, picking, atau packing secara runtut.",
            "Sebut kontrol akurasi stok, scan barcode, dan aturan FIFO atau FEFO bila relevan.",
            "Jelaskan tindakan saat ada mismatch, barang rusak, atau risiko keselamatan.",
        ],
        "general": [
            "Gunakan langkah kerja yang runtut dan spesifik.",
            "Sebut alasan teknis, kontrol risiko, dan trade-off.",
            "Tutup dengan hasil yang terukur atau standar keberhasilan.",
        ],
    }
    return hints.get(role_family, hints["general"])


def _extract_structured_sections(value: str):
    sections = {
        "evaluation": [],
        "follow_up": [],
        "question": [],
        "hint": [],
    }
    current_key = None
    heading_map = {
        "evaluasi jawaban": "evaluation",
        "tindak lanjut": "follow_up",
        "pertanyaan interview": "question",
        "poin jawaban kuat": "hint",
        "petunjuk jawaban kuat": "hint",
    }

    for raw_line in (value or "").replace("\r", "\n").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        candidate = re.sub(r"[*_#`~]+", "", line).strip()
        lowered = candidate.lower()

        matched_key = None
        matched_prefix = None
        for prefix, key in heading_map.items():
            if lowered.startswith(prefix):
                matched_key = key
                matched_prefix = prefix
                break

        if matched_key:
            current_key = matched_key
            remainder = candidate[len(matched_prefix):].lstrip(" :.-") if matched_prefix else ""
            cleaned_remainder = _clean_interview_line(remainder)
            if cleaned_remainder:
                sections[current_key].append(cleaned_remainder)
            continue

        cleaned_line = _clean_interview_line(candidate)
        if cleaned_line and current_key:
            sections[current_key].append(cleaned_line)

    return {key: "\n".join(values).strip() for key, values in sections.items()}


def _format_interview_question(question_text: str, hint_text: str, question_number: int) -> str:
    question = _clean_interview_line(question_text) or "Jelaskan pendekatan teknis Anda secara runtut, detail, dan terukur."
    hint_points = _split_points(hint_text, max_points=3) or [
        "Jelaskan langkah kerja secara runtut.",
        "Sebutkan alasan teknis dan trade-off utama.",
        "Tutup dengan hasil atau standar kualitas yang diharapkan.",
    ]
    lines = [
        f"Pertanyaan Interview {question_number}:",
        question,
        "",
        "Poin Jawaban Kuat:",
    ]
    lines.extend([f"• {point}" for point in hint_points])
    return "\n".join(lines).strip()


def _format_interview_turn_response(value: str, next_question: int, max_questions: int, role_family: str = "general") -> str:
    sections = _extract_structured_sections(value)
    evaluation_source = "\n".join(
        filter(
            None,
            [
                sections.get("evaluation", ""),
                sections.get("follow_up", ""),
            ],
        )
    )
    evaluation_points = _split_points(evaluation_source, max_points=3)
    if len(evaluation_points) < 2:
        evaluation_points = list(evaluation_points) + _role_specific_eval_points(role_family)
    evaluation_points = evaluation_points[:3]
    question_text = sections.get("question", "") or (
        f"Lanjut ke pertanyaan {next_question}/{max_questions}. Jelaskan cara Anda menangani masalah teknis kompleks secara runtut dari analisis sampai validasi hasil."
    )
    hint_text = sections.get("hint", "")
    hint_points = _split_points(hint_text, max_points=3) if hint_text else []
    if len(hint_points) < 2:
        hint_points = _role_specific_hint_points(role_family)

    lines = ["Evaluasi Jawaban:"]
    lines.extend([f"• {point}" for point in evaluation_points])
    lines.extend(["", f"Pertanyaan Interview {next_question}:", _clean_interview_line(question_text), "", "Poin Jawaban Kuat:"])
    lines.extend([f"• {point}" for point in hint_points[:3]])
    return "\n".join(lines).strip()


def _format_interview_completion(max_questions: int) -> str:
    return "\n".join(
        [
            "Evaluasi Jawaban:",
            f"• Sesi technical interview selesai sampai pertanyaan {max_questions}/{max_questions}.",
            "• Akhiri sesi sekarang untuk melihat ringkasan kekuatan, gap, dan tindak lanjut yang lebih tegas.",
        ]
    ).strip()


def _build_system_prompt(language: str, mode: str, context: str, max_questions: int, quality: str, role_family: str = "general") -> str:
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
        "Pertanyaan Interview 1: [question text]\n"
        "Poin Jawaban Kuat:\n"
        "• [practical point 1]\n"
        "• [practical point 2]\n"
        "• [practical point 3]\n\n"
        "After the candidate answers, first evaluate their answer briefly, then ask the next question with this exact format:\n"
        "Evaluasi Jawaban:\n"
        "• [brief technical strength or gap]\n"
        "• [one direct practical improvement]\n\n"
        "Pertanyaan Interview <n>: [next technical question]\n"
        "Poin Jawaban Kuat:\n"
        "• [practical point 1]\n"
        "• [practical point 2]\n"
        "• [practical point 3]\n\n"
        "Each question must be specific to the user's CV + selected analysis context and feel like real engineering interview drills.\n"
        "Do not use markdown, asterisks, underscores, hashtags, dashes as bullets, or decorative symbols. Use only plain text headings and bullet symbol •.\n"
        f"{_role_strictness_prompt(role_family)}\n"
        f"{depth_instruction}\n"
        f"{lang_hint}\n"
        f"{mode_hint}\n"
        "Candidate context:\n"
        f"{context}"
    )


def _session_cost_by_mode(mode: str, profile: dict) -> int:
    if (mode or "").strip().lower() == "speech":
        speech_cost = int(profile.get("speech_cost", SPEECH_SESSION_COST))
        return max(3, speech_cost) if speech_cost > 0 else 0
    text_cost = int(profile.get("text_cost", TEXT_SESSION_COST))
    return max(1, text_cost) if text_cost > 0 else 0


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

    r = _redis_client()
    stt_cache_key = None
    if r:
        try:
            stt_cache_key = f"fyjob:interview:stt:{hash_text(user_id, language, content_type or SPEECH_STT_CONTENT_TYPE, audio_base64)}"
            cached_transcript = r.get(stt_cache_key)
            if cached_transcript:
                return success_response({"transcriptText": cached_transcript, "cached": True})
        except Exception:
            stt_cache_key = None

    try:
        transcript = _speech_to_text(audio_base64, language, content_type=content_type)
    except ValueError as e:
        return error_response(str(e), 400)
    except Exception as e:
        return error_response(str(e), 502)

    if r and stt_cache_key:
        try:
            r.setex(stt_cache_key, max(60, STT_CACHE_TTL_SEC), transcript)
        except Exception:
            pass

    return success_response({"transcriptText": transcript, "cached": False})


def _tts_action(user_id: str, email: str, body: dict):
    user = check_and_regen_credits(user_id, email)
    profile, _plan, is_admin = _resolve_interview_profile(user, email)
    if not is_admin and not bool(profile.get("speech_enabled", False)):
        return error_response("Speech mode is available for Pro plan only", 403)

    text = body.get("text")
    language = body.get("language", "id")
    if not text:
        return error_response("text is required", 400)

    r = _redis_client()
    tts_cache_key = None
    if r:
        try:
            tts_cache_key = f"fyjob:interview:tts:{hash_text(language, text.strip())}"
            cached_audio = r.get(tts_cache_key)
            if cached_audio:
                return success_response(
                    {
                        "audioBase64": cached_audio,
                        "outputFormat": SPEECH_TTS_OUTPUT_FORMAT,
                        "cached": True,
                    }
                )
        except Exception:
            tts_cache_key = None

    try:
        audio_base64 = _text_to_speech(text, language)
    except ValueError as e:
        return error_response(str(e), 400)
    except Exception as e:
        return error_response(str(e), 502)

    if r and tts_cache_key:
        try:
            r.setex(tts_cache_key, max(60, TTS_CACHE_TTL_SEC), audio_base64)
        except Exception:
            pass

    return success_response(
        {
            "audioBase64": audio_base64,
            "outputFormat": SPEECH_TTS_OUTPUT_FORMAT,
            "cached": False,
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

    if not is_admin and plan == "free":
        return error_response("Interview Lite hanya untuk Basic/Pro plan. Silakan upgrade terlebih dahulu.", 403)

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

    role_family = _infer_role_family(context)
    system_prompt = _build_system_prompt(language, mode, context, max_questions=max_questions, quality=quality_mode, role_family=role_family)
    r = _redis_client()
    start_cache_key = f"fyjob:interview:start:{hash_text(user_id, analysis_id, language, mode, plan, quality_mode, max_questions, model_to_use)}"
    first_turn = None
    if r:
        try:
            first_turn = r.get(start_cache_key)
        except Exception:
            first_turn = None

    if not first_turn:
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
        if r and first_turn and first_turn.strip():
            try:
                r.setex(start_cache_key, max(60, START_CACHE_TTL_SEC), first_turn)
            except Exception:
                pass

    if not first_turn or not first_turn.strip():
        return error_response("Failed to generate first interview question", 500)

    first_turn = _format_interview_question(
        _extract_structured_sections(first_turn).get("question", first_turn),
        _extract_structured_sections(first_turn).get("hint", first_turn),
        1,
    )

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
        "role_family": role_family,
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
            assistant_text = _format_interview_completion(session_max_questions)
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
        role_family = str(session.get("role_family") or _infer_role_family(context) or "general")
        system_prompt = _build_system_prompt(
            session.get("language", "id"),
            session.get("mode", "text"),
            context,
            max_questions=session_max_questions,
            quality=session_quality,
            role_family=role_family,
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
                "Evaluasi Jawaban:\n"
                "• Jawaban Anda sudah punya arah, tetapi detail teknis dan trade-off masih kurang jelas.\n"
                "• Tambahkan alasan teknis, risiko utama, dan indikator hasil agar jawaban lebih kuat.\n\n"
                f"Pertanyaan Interview {next_question}:\n"
                "Jelaskan bagaimana Anda memecah masalah teknis kompleks dari analisis, eksekusi, sampai validasi hasil.\n\n"
                "Poin Jawaban Kuat:\n"
                "• Susun langkah kerja secara runtut.\n"
                "• Jelaskan trade-off dan risiko utama.\n"
                "• Tutup dengan hasil yang bisa diukur."
            )

        assistant_text = _format_interview_turn_response(assistant_text, next_question, session_max_questions, role_family=role_family)

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

    r = _redis_client()
    summary_cache_key = f"fyjob:interview:summary:{hash_text(user_id, session.get('analysisId', ''), transcript[-4000:])}"
    summary = None
    if r:
        try:
            summary = r.get(summary_cache_key)
        except Exception:
            summary = None

    if not summary:
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

    if r and summary:
        try:
            r.setex(summary_cache_key, max(60, SUMMARY_CACHE_TTL_SEC), summary)
        except Exception:
            pass

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
