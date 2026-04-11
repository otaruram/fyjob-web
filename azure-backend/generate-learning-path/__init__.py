"""
Azure Function: Generate Learning Path
POST /api/generate-learning-path — Rule-based study guide (no AI)
"""
import azure.functions as func
import logging
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits


def _extract_gap_name(gap_raw: str) -> str:
    if not gap_raw:
        return "General Skill"
    if "Missing:" in gap_raw:
        part = gap_raw.split("Missing:", 1)[1]
        return part.split("→", 1)[0].strip() or "General Skill"
    return gap_raw.strip() or "General Skill"


def _build_resources(skill: str):
    s = (skill or "general").lower()
    query = skill.replace(" ", "+")
    return [
        {
            "type": "article",
            "title": f"Core Concepts of {skill}",
            "url": f"https://roadmap.sh/search?query={query}",
            "platform": "roadmap.sh",
            "description": "Pelajari konsep inti dan urutan belajar"
        },
        {
            "type": "video",
            "title": f"Hands-on {skill} Tutorial",
            "url": f"https://www.youtube.com/results?search_query={query}+tutorial",
            "platform": "YouTube",
            "description": "Ikuti tutorial praktikal step-by-step"
        },
        {
            "type": "practice",
            "title": f"Mini Project: {skill}",
            "description": f"Bikin mini project 1 minggu untuk buktiin skill {skill} di portfolio"
        },
    ]


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Generate Learning Path function triggered")

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

        # Return existing learning path if already generated
        if analysis.get("learning_path"):
            return success_response({
                "learning_path": analysis["learning_path"],
                "analysis_id": analysis_id,
                "credits_remaining": user.get("credits_remaining", 0)
            })

        # Build deterministic learning path from top 3 gaps (free, no LLM call)
        raw_gaps = analysis.get("gaps", []) or []
        gap_names = []
        for g in raw_gaps:
            name = _extract_gap_name(g)
            if name and name not in gap_names:
                gap_names.append(name)

        if not gap_names:
            gap_names = ["Problem Solving", "Communication", "System Thinking"]

        selected = gap_names[:3]
        paths = []
        total_hours = 0
        for idx, gap_name in enumerate(selected, start=1):
            est_hours = 8 + (idx * 2)
            total_hours += est_hours
            paths.append({
                "path_number": idx,
                "skill_gap": gap_name,
                "topic": f"{gap_name} Sprint",
                "description": f"Fokus menutup gap {gap_name} dengan kombinasi belajar konsep dan praktik project.",
                "estimated_hours": est_hours,
                "difficulty": "intermediate" if idx > 1 else "beginner",
                "resources": _build_resources(gap_name),
            })

        learning_path = {
            "total_hours": total_hours,
            "paths": paths,
        }

        # Store in analysis record
        analysis["learning_path"] = learning_path
        analysis["learning_path_generated_at"] = datetime.utcnow().isoformat()
        history_container.upsert_item(analysis)

        return success_response({
            "learning_path": learning_path,
            "analysis_id": analysis_id,
            "credits_remaining": user.get("credits_remaining", 0)
        })

    except Exception as e:
        logging.error(f"Generate learning path error: {e}")
        return error_response(str(e))
