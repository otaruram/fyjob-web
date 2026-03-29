"""
Azure Function: Generate Killer Quiz
POST /api/generate-quiz — 10 MC + 5 Essay questions via Gemini 2.5 Pro
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits, deduct_credit
from shared.llm_service import call_llm_json, MODEL_GEMINI_PRO
from shared.prompts import KILLER_QUIZ_PROMPT


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Generate Quiz function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        user = check_and_regen_credits(user_id, email)
        if user.get("credits_remaining", 0) <= 0 and user.get("role") != "admin":
            return error_response("Insufficient credits", 403)

        body = req.get_json()
        analysis_id = body.get("analysisId")

        if not analysis_id:
            return error_response("analysisId is required", 400)

        # Load analysis
        history_container = get_container("AnalysisHistory")
        analyses = list(history_container.query_items(
            query=f"SELECT * FROM c WHERE c.id = '{analysis_id}' AND c.userId = '{user_id}'",
            enable_cross_partition_query=True
        ))

        if not analyses:
            return error_response("Analysis not found", 404)

        analysis = analyses[0]

        # Return existing quiz if already generated
        if analysis.get("killer_quiz"):
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

        quiz_data = call_llm_json(messages, model=MODEL_GEMINI_PRO, max_tokens=4000, temperature=0.7)

        # Store quiz in analysis record
        analysis["killer_quiz"] = quiz_data
        analysis["quiz_generated_at"] = datetime.utcnow().isoformat()
        history_container.upsert_item(analysis)

        remaining = deduct_credit(user_id)

        return success_response({
            "quiz": quiz_data,
            "analysis_id": analysis_id,
            "credits_remaining": remaining
        })

    except Exception as e:
        logging.error(f"Generate quiz error: {e}")
        return error_response(str(e))
