"""
Azure Function: Chat with Ujang HR AI
POST /api/chat — Conversational AI powered by Gemini 2.5 Pro via Sumopod
"""
import azure.functions as func
import logging
import os
import hashlib
from datetime import datetime, timedelta
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits
from shared.llm_service import call_llm
from shared.plan_access import get_plan_runtime, get_feature_lock_ttl
from shared.redis_cache import get_text, set_text, acquire_lock, release_lock, increment_window
from shared.prompts import UJANG_SYSTEM_PROMPT


CHAT_RATE_LIMIT_WINDOW_SEC = int(os.environ.get("CHAT_RATE_LIMIT_WINDOW_SEC", "60"))
CHAT_RATE_LIMIT_MAX_REQUESTS = int(os.environ.get("CHAT_RATE_LIMIT_MAX_REQUESTS", "8"))
CHAT_CACHE_TTL_SEC = int(os.environ.get("CHAT_CACHE_TTL_SEC", "600"))


def _normalize_text(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _build_prompt_key(user_id: str, analysis_id: str, message: str) -> str:
    payload = f"{user_id}|{analysis_id or ''}|{_normalize_text(message)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Chat function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        # Generate/Check credits (but DO NOT block chat if 0, chat is free)
        user = check_and_regen_credits(user_id, email)
        runtime = get_plan_runtime(user, "chat")
        plan = runtime["plan"]
        priority_lane = runtime["lane"]

        # Enforce CV upload before chat
        if not user.get("raw_cv_text"):
            return error_response("CV is not uploaded yet. Please upload your CV in CV Manager first.", 403)

        body = req.get_json()
        message = body.get("message", "").strip()
        analysis_id = body.get("analysisId")

        if not message:
            return error_response("Message is required", 400)

        chat_container = None
        try:
            chat_container = get_container("UjangChats")
        except Exception as e:
            logging.warning(f"UjangChats container unavailable: {e}")

        # Fast Redis rate limit first, then fallback to Cosmos history.
        redis_limit_key = f"fyjob:chat:ratelimit:{plan}:{user_id}"
        redis_count = increment_window(redis_limit_key, CHAT_RATE_LIMIT_WINDOW_SEC)
        effective_rate_limit = int(runtime.get("rate_limit_max", CHAT_RATE_LIMIT_MAX_REQUESTS))
        if redis_count and redis_count > effective_rate_limit:
            return error_response("Terlalu banyak request chat. Coba lagi dalam 1 menit.", 429)

        if not redis_count and chat_container:
            try:
                window_start = (datetime.utcnow() - timedelta(seconds=CHAT_RATE_LIMIT_WINDOW_SEC)).isoformat()
                limit_query = (
                    "SELECT VALUE COUNT(1) FROM c "
                    "WHERE c.userId = @uid AND c.created_at >= @window_start"
                )
                limit_params = [
                    {"name": "@uid", "value": user_id},
                    {"name": "@window_start", "value": window_start},
                ]
                count_rows = list(
                    chat_container.query_items(
                        query=limit_query,
                        parameters=limit_params,
                        enable_cross_partition_query=False,
                        partition_key=user_id,
                    )
                )
                request_count = int(count_rows[0]) if count_rows else 0
                if request_count >= effective_rate_limit:
                    return error_response("Terlalu banyak request chat. Coba lagi dalam 1 menit.", 429)
            except Exception as e:
                logging.warning(f"Chat rate limit check skipped: {e}")

        prompt_key = _build_prompt_key(user_id, analysis_id or "", message)
        redis_cache_key = f"fyjob:chat:cache:{plan}:{prompt_key}"
        redis_lock_key = f"fyjob:chat:lock:{priority_lane}:{prompt_key}"

        cached_text = get_text(redis_cache_key)
        if cached_text:
            return success_response({
                "response": cached_text,
                "credits_remaining": user.get("credits_remaining", 0),
                "cached": True,
                "cache_source": "redis",
                "plan": plan,
                "priority_lane": priority_lane,
            })

        # Cache identical prompt per user for a short window to cut LLM cost.
        if chat_container:
            try:
                cache_cutoff = (datetime.utcnow() - timedelta(seconds=CHAT_CACHE_TTL_SEC)).isoformat()
                cache_query = (
                    "SELECT TOP 1 c.latest_assistant_message, c.created_at FROM c "
                    "WHERE c.userId = @uid AND c.prompt_key = @pkey AND c.created_at >= @cutoff "
                    "ORDER BY c.created_at DESC"
                )
                cache_params = [
                    {"name": "@uid", "value": user_id},
                    {"name": "@pkey", "value": prompt_key},
                    {"name": "@cutoff", "value": cache_cutoff},
                ]
                cache_rows = list(
                    chat_container.query_items(
                        query=cache_query,
                        parameters=cache_params,
                        enable_cross_partition_query=False,
                        partition_key=user_id,
                    )
                )
                if cache_rows and cache_rows[0].get("latest_assistant_message"):
                    set_text(redis_cache_key, cache_rows[0]["latest_assistant_message"], int(runtime.get("cache_ttl_sec", CHAT_CACHE_TTL_SEC)))
                    return success_response({
                        "response": cache_rows[0]["latest_assistant_message"],
                        "credits_remaining": user.get("credits_remaining", 0),
                        "cached": True,
                        "cache_source": "cosmos",
                        "plan": plan,
                        "priority_lane": priority_lane,
                    })
            except Exception as e:
                logging.warning(f"Chat cache lookup skipped: {e}")

        lock_token = acquire_lock(redis_lock_key, get_feature_lock_ttl("chat"))
        if not lock_token:
            return error_response("Chat request is already being processed. Please retry shortly.", 409)

        try:
            # Build context from user CV and analysis
            context_parts = []

            # Add CV context
            cv_text = user.get("raw_cv_text", "")
            if cv_text:
                cv_limit = 1200 if plan == "free" else 1700 if plan == "basic" else 2400 if plan == "pro" else 3200
                context_parts.append(f"<UserContext>\n  <LatestCV>\n{cv_text[:cv_limit]}\n  </LatestCV>\n</UserContext>")

            # Add analysis context if available
            if analysis_id:
                try:
                    history_container = get_container("AnalysisHistory")
                    a = history_container.read_item(item=analysis_id, partition_key=user_id)
                    context_parts.append(
                        f"<AnalysisContext>\n"
                        f"  <JobTitle>{a.get('jobTitle', 'Unknown')}</JobTitle>\n"
                        f"  <MatchScore>{a.get('matchScore', 'N/A')}</MatchScore>\n"
                        f"  <PastIdentifiedGaps>{', '.join(a.get('gaps', []))}</PastIdentifiedGaps>\n"
                        f"</AnalysisContext>\n"
                        f"<SpecialInstruction>\n"
                        f"  Compare the <PastIdentifiedGaps> from the old job analysis with the user's <LatestCV>. "
                        f"If the <LatestCV> now contains the skills they previously lacked, heavily compliment their progress and tell them they are better fit for the job now.\n"
                        f"</SpecialInstruction>"
                    )
                except Exception as e:
                    logging.warning(f"Could not load analysis context: {e}")

            # Load conversation history
            conversation_history = body.get("conversationHistory", [])

            # Build messages for LLM
            system_message = UJANG_SYSTEM_PROMPT
            if context_parts:
                system_message += "\n\n--- USER CONTEXT ---\n" + "\n\n".join(context_parts)

            messages = [{"role": "system", "content": system_message}]

            for msg in conversation_history[-10:]:
                messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

            messages.append({"role": "user", "content": message})

            model_to_use = runtime["model"]

            response_text = call_llm(messages, model=model_to_use, max_tokens=int(runtime.get("max_tokens", 1000)), temperature=0.8)

            if not response_text or not response_text.strip():
                response_text = "Hah? Maksud lu apa nge-ping/ngetik nggak jelas gitu doang? Coba ketik yang bener, gw ini HR sibuk bro."

            set_text(redis_cache_key, response_text, int(runtime.get("cache_ttl_sec", CHAT_CACHE_TTL_SEC)))

            try:
                if not chat_container:
                    chat_container = get_container("UjangChats")
                chat_doc = {
                    "id": f"chat_{user_id}_{datetime.utcnow().timestamp()}",
                    "userId": user_id,
                    "analysisId": analysis_id or "",
                    "prompt_key": prompt_key,
                    "latest_user_message": message,
                    "latest_assistant_message": response_text,
                    "messages": conversation_history + [
                        {"role": "user", "content": message},
                        {"role": "assistant", "content": response_text}
                    ],
                    "plan": plan,
                    "priority_lane": priority_lane,
                    "model_used": model_to_use,
                    "created_at": datetime.utcnow().isoformat()
                }
                chat_container.upsert_item(chat_doc)
            except Exception as e:
                logging.warning(f"Failed to save chat history: {e}")

            remaining = user.get("credits_remaining", 0)

            return success_response({
                "response": response_text,
                "credits_remaining": remaining,
                "cached": False,
                "plan": plan,
                "priority_lane": priority_lane,
                "model_used": model_to_use,
            })
        finally:
            release_lock(redis_lock_key, lock_token)

    except Exception as e:
        logging.error(f"Chat error: {e}")
        return error_response(str(e))
