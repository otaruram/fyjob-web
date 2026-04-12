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
from shared.llm_service import call_llm_json
from shared.plan_access import get_plan_runtime, get_feature_lock_ttl
from shared.redis_cache import get_json, set_json, hash_text, acquire_lock, release_lock
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
        runtime = get_plan_runtime(user, "analyze")
        plan = runtime["plan"]
        priority_lane = runtime["lane"]

        # Enforce CV upload before any analysis operation
        if not user.get("raw_cv_text"):
            return error_response("CV is not uploaded yet. Please upload your CV in CV Manager first.", 403)

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

        request_hash = hash_text(user_id, plan, job_title, company, portal, url, job_desc[:1500], user.get("cv_uploaded_at", ""))
        redis_cache_key = f"fyjob:analyze:cache:{request_hash}"
        redis_lock_key = f"fyjob:analyze:lock:{priority_lane}:{request_hash}"

        cached_analysis = get_json(redis_cache_key)
        if isinstance(cached_analysis, dict):
            remaining = deduct_credit(user_id)
            return success_response({
                **cached_analysis,
                "credits_remaining": remaining,
                "cached": True,
                "cache_source": "redis",
                "plan": plan,
                "priority_lane": priority_lane,
            })

        # ─── 1. Caching Check ───
        # Avoid hitting Gemini if user analyzed this identical job recently
        history_container = get_container("AnalysisHistory")
        cache_query = (
            "SELECT * FROM c WHERE c.userId = @uid AND c.analysis_plan = @plan "
            "AND (c.url = @url OR c.jobTitle = @job) ORDER BY c._ts DESC"
        )
        parameters = [
            {"name": "@uid", "value": user_id},
            {"name": "@plan", "value": plan},
            {"name": "@url", "value": url},
            {"name": "@job", "value": job_title}
        ]
        
        try:
            cached_results = list(history_container.query_items(
                query=cache_query,
                parameters=parameters,
                enable_cross_partition_query=False,
                partition_key=user_id
            ))
            
            if cached_results:
                # Cache hit! Return cached data directly to save tokens
                analysis = cached_results[0]
                remaining = deduct_credit(user_id)
                payload = {
                    "id": analysis["id"],
                    "analysis_id": analysis["id"],
                    "jobTitle": analysis.get("jobTitle", job_title),
                    "matchScore": analysis.get("matchScore", 0),
                    "gaps": analysis.get("gaps", []),
                    "insights": analysis.get("insights", []),
                    "scamDetection": analysis.get("scamDetection", {}),
                    "plan": plan,
                    "priority_lane": priority_lane,
                    "model_used": analysis.get("model_used", runtime["model"]),
                }
                set_json(redis_cache_key, payload, runtime["cache_ttl_sec"])
                logging.info(f"Cache hit for job: {job_title}")
                return success_response({
                    **payload,
                    "credits_remaining": remaining,
                    "cached": True,
                    "cache_source": "cosmos",
                })
        except Exception as e:
            logging.warning(f"Cache query error: {e}")

        lock_token = acquire_lock(redis_lock_key, get_feature_lock_ttl("analyze"))
        if not lock_token:
            return error_response("Analysis request is already being processed. Please retry shortly.", 409)

        try:
            # ─── 2. Build Analysis Prompt with XML Structure ───
            cv_text = user.get("raw_cv_text", "")
            user_context = ""
            if cv_text:
                user_context = f"\n<UserContext>\n  <CV>\n{cv_text[:runtime['cv_limit']]}\n  </CV>\n</UserContext>"

            full_prompt = f"""Analyze this job posting compared to the candidate's CV. Provide ONLY JSON output.

<JobContext>
  <JobTitle>{job_title}</JobTitle>
  <Company>{company}</Company>
  <Portal>{portal}</Portal>
  <JobDescription>\n{job_desc[:runtime['job_desc_limit']]}\n  </JobDescription>
</JobContext>
{user_context}

{ANALYZE_PROMPT}"""

            messages = [
                {"role": "system", "content": "You are a Senior Tech Recruiter AI from Google. Output ONLY valid JSON."},
                {"role": "user", "content": full_prompt}
            ]

            model_to_use = runtime["model"]

            # Call LLM
            analysis = call_llm_json(messages, model=model_to_use, max_tokens=runtime["max_tokens"], temperature=0.7)

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
                "analysis_plan": plan,
                "priority_lane": priority_lane,
                "model_used": model_to_use,
                "created_at": datetime.utcnow().isoformat()
            }
            history_container.create_item(history_doc)

            payload = {
                "id": history_doc["id"],
                "analysis_id": history_doc["id"],
                "jobTitle": job_title,
                "matchScore": analysis.get("matchScore", 0),
                "gaps": analysis.get("gaps", []),
                "insights": analysis.get("insights", []),
                "scamDetection": analysis.get("scamDetection", {}),
                "plan": plan,
                "priority_lane": priority_lane,
                "model_used": model_to_use,
            }
            set_json(redis_cache_key, payload, runtime["cache_ttl_sec"])

            # Deduct credit
            remaining = deduct_credit(user_id)

            return success_response({
                **payload,
                "credits_remaining": remaining,
                "cached": False,
            })
        finally:
            release_lock(redis_lock_key, lock_token)

    except Exception as e:
        logging.error(f"Analyze error: {e}")
        return error_response(str(e))
