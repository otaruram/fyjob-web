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


def _safe_list(value):
    return value if isinstance(value, list) else []


def _normalize_options(raw_options):
    if isinstance(raw_options, dict):
        return {
            "A": str(raw_options.get("A", "")) or "Option A",
            "B": str(raw_options.get("B", "")) or "Option B",
            "C": str(raw_options.get("C", "")) or "Option C",
            "D": str(raw_options.get("D", "")) or "Option D",
        }

    if isinstance(raw_options, list):
        vals = [str(x) for x in raw_options[:4]]
        while len(vals) < 4:
            vals.append(f"Option {chr(65 + len(vals))}")
        return {"A": vals[0], "B": vals[1], "C": vals[2], "D": vals[3]}

    return {
        "A": "Prioritize quick wins aligned with role goals",
        "B": "Delay execution until all variables are perfect",
        "C": "Use random trial-and-error without metrics",
        "D": "Skip stakeholder communication",
    }


def _normalize_mcq(item, index: int, job_title: str):
    if not isinstance(item, dict):
        item = {}

    question = str(item.get("question") or "").strip() or f"For the {job_title} role, which option is the strongest data-driven decision in scenario {index}?"
    options = _normalize_options(item.get("options"))
    correct = str(item.get("correct_answer") or "A").strip().upper()
    if correct not in {"A", "B", "C", "D"}:
        correct = "A"

    return {
        "question_number": index,
        "question": question,
        "options": options,
        "correct_answer": correct,
        "difficulty": str(item.get("difficulty") or "medium"),
        "explanation": str(item.get("explanation") or "Choose the option with best signal quality, prioritization logic, and measurable impact."),
        "relevant_skill": str(item.get("relevant_skill") or "Problem solving"),
    }


def _normalize_essay(item, index: int, job_title: str):
    if not isinstance(item, dict):
        item = {}

    question = str(item.get("question") or "").strip() or f"Describe your end-to-end strategy to solve a high-priority challenge in the {job_title} role."
    expected_points = item.get("expected_points")
    if not isinstance(expected_points, list) or not expected_points:
        expected_points = [
            "Clear problem framing and objective",
            "Trade-off analysis and prioritization",
            "Execution plan with measurable outcomes",
        ]

    return {
        "question_number": index,
        "question": question,
        "difficulty": str(item.get("difficulty") or "hard"),
        "expected_points": [str(x) for x in expected_points[:5]],
        "relevant_skill": str(item.get("relevant_skill") or "Communication and technical reasoning"),
    }


def _normalize_quiz_payload(payload, job_title: str):
    data = payload if isinstance(payload, dict) else {}
    raw_mcq = _safe_list(data.get("multiple_choice") or data.get("multipleChoice"))
    raw_essay = _safe_list(data.get("essay") or data.get("essays"))

    mcq = [_normalize_mcq(raw_mcq[i] if i < len(raw_mcq) else {}, i + 1, job_title) for i in range(5)]
    essay = [_normalize_essay(raw_essay[i] if i < len(raw_essay) else {}, i + 1, job_title) for i in range(5)]

    return {
        "job_context": str(data.get("job_context") or f"FAANG-style interview simulation for {job_title}"),
        "multiple_choice": mcq,
        "essay": essay,
    }


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
        raw_quiz_data = call_llm_json(messages, model=model_to_use, max_tokens=4000, temperature=0.7)
        quiz_data = _normalize_quiz_payload(raw_quiz_data, analysis.get("jobTitle", "this role"))

        if not _is_quiz_shape_valid(quiz_data):
            logging.error("Quiz normalization failed to create a valid 5+5 payload")
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
