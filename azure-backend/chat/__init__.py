"""
Azure Function: Chat with Ujang HR AI
POST /api/chat — Conversational AI powered by Gemini 2.5 Pro via Sumopod
"""
import azure.functions as func
import logging
import os
import hashlib
from datetime import datetime, timedelta
from shared.auth import authenticate, error_response, success_response, CORS_HEADERS
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

def _get_chat_history(user_id: str):
    try:
        container = get_container("UjangChats")
        query = "SELECT * FROM c WHERE c.userId = @uid ORDER BY c.created_at DESC"
        rows = list(container.query_items(query=query, parameters=[{"name": "@uid", "value": user_id}]))
        history = []
        for row in rows:
            history.append({
                "id": row.get("id"),
                "analysisId": row.get("analysisId", ""),
                "latest_user_message": row.get("latest_user_message", ""),
                "latest_assistant_message": row.get("latest_assistant_message", ""),
                "created_at": row.get("created_at", "")
            })
        return success_response({"history": history})
    except Exception as e:
        logging.error(f"Error fetching chat history: {e}")
        return error_response(str(e))

def _get_chat_session(user_id: str, session_id: str):
    if not session_id:
        return error_response("sessionId is required", 400)
    try:
        container = get_container("UjangChats")
        doc = container.read_item(item=session_id, partition_key=user_id)
        if doc.get("userId") != user_id:
            return error_response("Unauthorized", 403)
        return success_response({"session": doc})
    except Exception as e:
        return error_response("Session not found", 404)

def _delete_chat_session(user_id: str, session_id: str):
    if not session_id:
        return error_response("sessionId is required", 400)
    try:
        container = get_container("UjangChats")
        doc = container.read_item(item=session_id, partition_key=user_id)
        if doc.get("userId") != user_id:
            return error_response("Unauthorized", 403)
        container.delete_item(item=session_id, partition_key=user_id)
        return success_response({"ok": True, "deleted": session_id})
    except Exception as e:
        return error_response("Session not found", 404)

def _process_chat(user_id: str, email: str, body: dict, user: dict, runtime: dict):
    plan = runtime["plan"]
    priority_lane = runtime["lane"]
    message = body.get("message", "").strip()
    analysis_id = body.get("analysisId", "")
    session_id = body.get("sessionId", "")
    
    if not message:
        return error_response("Message is required", 400)

    chat_container = None
    try:
        chat_container = get_container("UjangChats")
    except Exception as e:
        logging.warning(f"UjangChats container unavailable: {e}")

    redis_limit_key = f"fyjob:chat:ratelimit:{plan}:{user_id}"
    redis_count = increment_window(redis_limit_key, CHAT_RATE_LIMIT_WINDOW_SEC)
    effective_rate_limit = int(runtime.get("rate_limit_max", CHAT_RATE_LIMIT_MAX_REQUESTS))
    if redis_count and redis_count > effective_rate_limit:
        return error_response("Terlalu banyak request chat. Coba lagi dalam 1 menit.", 429)

    prompt_key = _build_prompt_key(user_id, analysis_id, message)
    redis_lock_key = f"fyjob:chat:lock:{priority_lane}:{prompt_key}"

    lock_token = acquire_lock(redis_lock_key, get_feature_lock_ttl("chat"))
    if not lock_token:
        return error_response("Chat request is already being processed. Please retry shortly.", 409)

    try:
        session_doc = None
        conversation_history = []
        if session_id and chat_container:
            try:
                session_doc = chat_container.read_item(item=session_id, partition_key=user_id)
                if session_doc.get("userId") == user_id:
                    conversation_history = session_doc.get("messages", [])
            except Exception:
                pass

        context_parts = []
        cv_text = user.get("raw_cv_text", "")
        if cv_text:
            cv_limit = 1200 if plan == "free" else 1700 if plan == "basic" else 2400 if plan == "pro" else 3200
            context_parts.append(f"<UserContext>\n  <LatestCV>\n{cv_text[:cv_limit]}\n  </LatestCV>\n</UserContext>")

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

        system_message = UJANG_SYSTEM_PROMPT
        if context_parts:
            system_message += "\n\n--- USER CONTEXT ---\n" + "\n\n".join(context_parts)

        messages = [{"role": "system", "content": system_message}]
        
        for msg in conversation_history[-20:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

        messages.append({"role": "user", "content": message})

        model_to_use = runtime["model"]
        response_text = call_llm(messages, model=model_to_use, max_tokens=int(runtime.get("max_tokens", 1000)), temperature=0.8)

        if not response_text or not response_text.strip():
            response_text = "Hah? Maksud lu apa nge-ping/ngetik nggak jelas gitu doang? Coba ketik yang bener, gw ini HR sibuk bro."

        try:
            if not chat_container:
                chat_container = get_container("UjangChats")
            
            if not session_doc:
                session_id = f"chat_{user_id}_{datetime.utcnow().timestamp()}"
                session_doc = {
                    "id": session_id,
                    "userId": user_id,
                    "analysisId": analysis_id,
                    "created_at": datetime.utcnow().isoformat(),
                    "messages": []
                }
            
            session_doc["prompt_key"] = prompt_key
            session_doc["latest_user_message"] = message
            session_doc["latest_assistant_message"] = response_text
            session_doc["plan"] = plan
            session_doc["priority_lane"] = priority_lane
            session_doc["model_used"] = model_to_use
            session_doc["updated_at"] = datetime.utcnow().isoformat()
            
            session_doc["messages"].append({"role": "user", "content": message})
            session_doc["messages"].append({"role": "assistant", "content": response_text})
            
            chat_container.upsert_item(session_doc)
        except Exception as e:
            logging.warning(f"Failed to save chat history: {e}")

        remaining = user.get("credits_remaining", 0)

        return success_response({
            "response": response_text,
            "sessionId": session_id,
            "credits_remaining": remaining,
            "cached": False,
            "plan": plan,
            "priority_lane": priority_lane,
            "model_used": model_to_use,
        })
    finally:
        release_lock(redis_lock_key, lock_token)

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Chat function triggered")

    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=200, headers=CORS_HEADERS)

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        user = check_and_regen_credits(user_id, email)
        runtime = get_plan_runtime(user, "chat")
        
        body = {}
        try:
            body = req.get_json()
        except Exception:
            pass

        action = (body.get("action") or "chat").strip().lower()

        if action == "history":
            return _get_chat_history(user_id)
        elif action == "get-session":
            return _get_chat_session(user_id, body.get("sessionId"))
        elif action == "delete":
            return _delete_chat_session(user_id, body.get("sessionId"))
        elif action == "chat":
            if not user.get("raw_cv_text"):
                return error_response("CV is not uploaded yet. Please upload your CV in CV Manager first.", 403)
            return _process_chat(user_id, email, body, user, runtime)
        else:
            return error_response("Invalid action", 400)

    except Exception as e:
        logging.error(f"Chat error: {e}")
        return error_response(str(e))
