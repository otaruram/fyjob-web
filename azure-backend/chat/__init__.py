"""
Azure Function: Chat with Ujang HR AI
POST /api/chat — Conversational AI powered by Gemini 2.5 Pro via Sumopod
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response, CORS_HEADERS
from shared.cosmos_client import get_container, check_and_regen_credits, deduct_credit
from shared.llm_service import call_llm, MODEL_GEMINI_PRO
from shared.prompts import UJANG_SYSTEM_PROMPT


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Chat function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        # Check credits
        user = check_and_regen_credits(user_id, email)
        if user.get("credits_remaining", 0) <= 0 and user.get("role") != "admin":
            return error_response("Insufficient credits", 403)

        body = req.get_json()
        message = body.get("message", "").strip()
        analysis_id = body.get("analysisId")

        if not message:
            return error_response("Message is required", 400)

        # Build context from user CV and analysis
        context_parts = []

        # Add CV context
        cv_text = user.get("raw_cv_text", "")
        if cv_text:
            context_parts.append(f"USER'S CV:\n{cv_text[:1500]}")

        # Add analysis context if available
        if analysis_id:
            try:
                history_container = get_container("AnalysisHistory")
                analyses = list(history_container.query_items(
                    query=f"SELECT * FROM c WHERE c.id = '{analysis_id}'",
                    enable_cross_partition_query=True
                ))
                if analyses:
                    a = analyses[0]
                    context_parts.append(
                        f"LATEST JOB ANALYSIS:\n"
                        f"Job: {a.get('jobTitle', 'Unknown')}\n"
                        f"Match Score: {a.get('matchScore', 'N/A')}%\n"
                        f"Gaps: {', '.join(a.get('gaps', []))}"
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
        
        # Add conversation history (last 10 messages)
        for msg in conversation_history[-10:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
        
        messages.append({"role": "user", "content": message})

        # Determine model based on role and tier
        role = user.get("role", "user")
        tier = user.get("tier", "free")
        
        from shared.llm_service import MODEL_GEMINI_FLASH, MODEL_GEMINI_3_PRO, MODEL_CLAUDE_HAIKU
        
        if role == "admin":
            model_to_use = MODEL_GEMINI_3_PRO
        elif tier == "pro":
            model_to_use = MODEL_CLAUDE_HAIKU
        else:
            # Free tier fallback
            model_to_use = MODEL_GEMINI_FLASH

        # Call LLM via Sumopod
        response_text = call_llm(messages, model=model_to_use, max_tokens=1000, temperature=0.8)

        if not response_text or not response_text.strip():
            response_text = "Hah? Maksud lu apa nge-ping/ngetik nggak jelas gitu doang? Coba ketik yang bener, gw ini HR sibuk bro."


        # Save chat to Cosmos DB
        try:
            chat_container = get_container("UjangChats")
            chat_doc = {
                "id": f"chat_{user_id}_{datetime.utcnow().timestamp()}",
                "userId": user_id,
                "analysisId": analysis_id or "",
                "messages": conversation_history + [
                    {"role": "user", "content": message},
                    {"role": "assistant", "content": response_text}
                ],
                "created_at": datetime.utcnow().isoformat()
            }
            chat_container.upsert_item(chat_doc)
        except Exception as e:
            logging.warning(f"Failed to save chat history: {e}")

        # Deduct credit
        remaining = deduct_credit(user_id)

        return success_response({
            "response": response_text,
            "credits_remaining": remaining
        })

    except Exception as e:
        logging.error(f"Chat error: {e}")
        return error_response(str(e))
