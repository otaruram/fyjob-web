"""
Azure Function: Generate Learning Path
POST /api/generate-learning-path — AI-generated study guide via Gemini 2.5 Pro
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits, deduct_credit
from shared.llm_service import call_llm_json, MODEL_GEMINI_PRO
from shared.prompts import LEARNING_PATH_PROMPT


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Generate Learning Path function triggered")

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

        # Return existing learning path if already generated
        if analysis.get("learning_path"):
            return success_response({
                "learning_path": analysis["learning_path"],
                "analysis_id": analysis_id,
                "credits_remaining": user.get("credits_remaining", 0)
            })

        # Build context
        context = (
            f"Job Title: {analysis.get('jobTitle', 'Unknown')}\n"
            f"Match Score: {analysis.get('matchScore', 'N/A')}%\n"
            f"Skill Gaps: {', '.join(analysis.get('gaps', []))}\n"
            f"Job Description: {analysis.get('jobDescription', '')[:1000]}"
        )

        # Add user CV context
        cv_text = user.get("raw_cv_text", "")
        if cv_text:
            context += f"\n\nUser CV Summary: {cv_text[:500]}"

        messages = [
            {"role": "system", "content": LEARNING_PATH_PROMPT},
            {"role": "user", "content": f"Generate a learning path for this job:\n\n{context}"}
        ]

        learning_path = call_llm_json(messages, model=MODEL_GEMINI_PRO, max_tokens=3000, temperature=0.7)

        # Store in analysis record
        analysis["learning_path"] = learning_path
        analysis["learning_path_generated_at"] = datetime.utcnow().isoformat()
        history_container.upsert_item(analysis)

        remaining = deduct_credit(user_id)

        return success_response({
            "learning_path": learning_path,
            "analysis_id": analysis_id,
            "credits_remaining": remaining
        })

    except Exception as e:
        logging.error(f"Generate learning path error: {e}")
        return error_response(str(e))
