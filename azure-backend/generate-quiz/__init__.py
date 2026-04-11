"""
Azure Function: Generate Killer Quiz
POST /api/generate-quiz — 5 MC + 5 Essay questions via Gemini
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits
from shared.llm_service import call_llm_json, MODEL_GEMINI_FLASH, MODEL_GEMINI_3_PRO
from shared.prompts import KILLER_QUIZ_PROMPT
from shared.email_service import send_new_quiz_alert


def _is_quiz_shape_valid(quiz_payload) -> bool:
    if not isinstance(quiz_payload, dict):
        return False
    mcq = quiz_payload.get("multiple_choice") or []
    essay = quiz_payload.get("essay") or []
    return isinstance(mcq, list) and isinstance(essay, list) and len(mcq) == 5 and len(essay) == 5


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Generate Quiz function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        user = check_and_regen_credits(user_id, email)
        if not user.get("raw_cv_text"):
            return error_response("CV is not uploaded yet. Please upload your CV in CV Manager first.", 403)

        body = req.get_json()
        analysis_id = body.get("analysisId")

        if not analysis_id:
            return error_response("analysisId is required", 400)

        # Load analysis
        history_container = get_container("AnalysisHistory")
        try:
            analysis = history_container.read_item(item=analysis_id, partition_key=user_id)
        except Exception:
            return error_response("Analysis not found", 404)

        if analysis.get("userId") != user_id:
            return error_response("Analysis not found", 404)

        # Return existing quiz when shape is valid (5 MCQ + 5 Essay).
        # Legacy quiz payloads are regenerated once to keep UX consistent.
        if analysis.get("killer_quiz") and _is_quiz_shape_valid(analysis.get("killer_quiz")):
            return success_response({
                "quiz": analysis["killer_quiz"],
                "analysis_id": analysis_id,
                "credits_remaining": user.get("credits_remaining", 0)
            })

        # Build prompt context
        context = (
            f"Job Title: {analysis.get('jobTitle', 'Unknown')}\n"
            f"Match Score: {analysis.get('matchScore', 'N/A')}%\n"
            f"Skill Gaps: {', '.join(analysis.get('gaps', []))}\n"
            f"Job Description: {analysis.get('jobDescription', '')[:1000]}"
        )

        messages = [
            {"role": "system", "content": KILLER_QUIZ_PROMPT},
            {"role": "user", "content": f"Generate a killer quiz based on this job analysis:\n\n{context}"}
        ]

        model_to_use = MODEL_GEMINI_3_PRO if user.get("role") == "admin" else MODEL_GEMINI_FLASH
        quiz_data = call_llm_json(messages, model=model_to_use, max_tokens=4000, temperature=0.7)

        # Keep payload shape deterministic for frontend navigation and scoring.
        if isinstance(quiz_data, dict):
            quiz_data["multiple_choice"] = (quiz_data.get("multiple_choice") or [])[:5]
            quiz_data["essay"] = (quiz_data.get("essay") or [])[:5]

        if not _is_quiz_shape_valid(quiz_data):
            return error_response("Quiz generation failed. Please retry.", 500)

        # Store quiz in analysis record
        analysis["killer_quiz"] = quiz_data
        analysis["quiz_generated_at"] = datetime.utcnow().isoformat()
        history_container.upsert_item(analysis)

        # Optional email alert when user enabled new-quiz notifications.
        try:
            prefs = user.get("alert_prefs", {}) or {}
            if prefs.get("email_new_quiz", False) and email:
                send_new_quiz_alert(email, analysis.get("jobTitle", "Target Role"))
        except Exception as e:
            logging.warning(f"Failed sending new quiz email alert: {e}")

        return success_response({
            "quiz": quiz_data,
            "analysis_id": analysis_id,
            "credits_remaining": user.get("credits_remaining", 0)
        })

    except Exception as e:
        logging.error(f"Generate quiz error: {e}")
        return error_response(str(e))
