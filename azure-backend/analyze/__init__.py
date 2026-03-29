"""
Azure Function: Analyze Job
POST /api/analyze — CV vs Job analysis with FAANG-level scoring
Uses shared modules for auth, credits, and LLM.
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits, deduct_credit
from shared.llm_service import call_llm_json, MODEL_CLAUDE_HAIKU, MODEL_GEMINI_FLASH, MODEL_GEMINI_3_PRO, MODEL_GEMINI_PRO
from shared.prompts import ANALYZE_PROMPT


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Analyze function triggered")

    # Handle CORS preflight
    if req.method == "OPTIONS":
        from shared.auth import CORS_HEADERS
        return func.HttpResponse("", status_code=200, headers=CORS_HEADERS)

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        # Credit check with regen
        user = check_and_regen_credits(user_id, email)
        if user.get("credits_remaining", 0) <= 0 and user.get("role") != "admin":
            return error_response("Insufficient credits", 403)

        # Parse body
        try:
            body = req.get_json()
        except ValueError:
            return error_response("Invalid JSON body", 400)

        job_desc = body.get("jobDescription", "")
        job_title = body.get("jobTitle", "Unknown Position")
        company = body.get("company", "")
        portal = body.get("portal", "Unknown")
        url = body.get("url", "")

        if not job_desc or len(job_desc) < 50:
            return error_response("jobDescription must be at least 50 characters", 400)

        # Build analysis prompt with CV context
        cv_text = user.get("raw_cv_text", "")
        user_context = ""
        if cv_text:
            user_context = f"\n\nCANDIDATE'S CV:\n{cv_text[:2000]}"

        full_prompt = f"""Analyze this job posting and the candidate's CV. Provide ONLY JSON output.

Job Title: {job_title}
Company: {company}
Portal: {portal}

Job Description:
{job_desc[:4000]}
{user_context}

{ANALYZE_PROMPT}"""

        messages = [
            {"role": "system", "content": "You are a Senior Tech Recruiter AI from Google. Output ONLY valid JSON."},
            {"role": "user", "content": full_prompt}
        ]

        # Determine model based on role and tier
        role = user.get("role", "user")
        tier = user.get("tier", "free")
        
        if role == "admin":
            model_to_use = MODEL_GEMINI_3_PRO
        elif tier == "pro":
            model_to_use = MODEL_CLAUDE_HAIKU
        else:
            # Free tier and default fallback
            model_to_use = MODEL_GEMINI_FLASH

        # Call LLM
        analysis = call_llm_json(messages, model=model_to_use, max_tokens=2000, temperature=0.7)

        # Ensure required fields
        if not isinstance(analysis, dict):
            analysis = {}

        analysis.setdefault("matchScore", 50)
        analysis.setdefault("gaps", [])
        analysis.setdefault("insights", [])
        analysis.setdefault("scamDetection", {"isScam": False, "reason": "", "salaryRange": "N/A"})

        # Convert insights to list if it's a dict (old format compatibility)
        if isinstance(analysis.get("insights"), dict):
            insight_obj = analysis["insights"]
            summary_parts = []
            for key, val in insight_obj.items():
                if isinstance(val, str):
                    summary_parts.append(val)
                elif isinstance(val, dict) and "reason" in val:
                    summary_parts.append(f"{key}: {val['reason']}")
            analysis["insights"] = summary_parts if summary_parts else ["Analysis completed."]

        # Save to AnalysisHistory
        history_container = get_container("AnalysisHistory")
        history_doc = {
            "id": f"{user_id}_{datetime.utcnow().timestamp()}",
            "userId": user_id,
            "jobTitle": job_title,
            "company": company,
            "portal": portal,
            "url": url,
            "jobDescription": job_desc[:3000],
            "matchScore": analysis.get("matchScore", 0),
            "gaps": analysis.get("gaps", []),
            "insights": analysis.get("insights", []),
            "scamDetection": analysis.get("scamDetection", {}),
            "created_at": datetime.utcnow().isoformat()
        }
        history_container.create_item(history_doc)

        # Deduct credit
        remaining = deduct_credit(user_id)

        return success_response({
            "id": history_doc["id"],
            "analysis_id": history_doc["id"],
            "jobTitle": job_title,
            "matchScore": analysis.get("matchScore", 0),
            "gaps": analysis.get("gaps", []),
            "insights": analysis.get("insights", []),
            "scamDetection": analysis.get("scamDetection", {}),
            "credits_remaining": remaining
        })

    except Exception as e:
        logging.error(f"Analyze error: {e}")
        return error_response(str(e))
