"""
Azure Function: Quiz Submit & Evaluate
POST /api/quiz-submit — Evaluate MC answers + essay via Gemini 2.5 Pro
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, check_and_regen_credits, deduct_credit
from shared.llm_service import call_llm_json, MODEL_GEMINI_PRO
from shared.prompts import ESSAY_EVAL_PROMPT


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Quiz Submit function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        user = check_and_regen_credits(user_id, email)

        body = req.get_json()
        analysis_id = body.get("analysisId")
        answers = body.get("answers", {})

        if not analysis_id:
            return error_response("analysisId is required", 400)

        # Load analysis with quiz
        history_container = get_container("AnalysisHistory")
        analyses = list(history_container.query_items(
            query=f"SELECT * FROM c WHERE c.id = '{analysis_id}' AND c.userId = '{user_id}'",
            enable_cross_partition_query=True
        ))

        if not analyses:
            return error_response("Analysis not found", 404)

        analysis = analyses[0]
        quiz = analysis.get("killer_quiz")

        if not quiz:
            return error_response("No quiz generated for this analysis", 400)

        # ─── Evaluate Multiple Choice ───
        mc_answers = answers.get("multiple_choice", {})
        mc_questions = quiz.get("multiple_choice", [])
        mc_correct = 0
        mc_results = []

        for q in mc_questions:
            qnum = str(q["question_number"])
            user_answer = mc_answers.get(qnum, "")
            correct = q.get("correct_answer", "")
            is_correct = user_answer.upper() == correct.upper()
            if is_correct:
                mc_correct += 1
            mc_results.append({
                "question_number": q["question_number"],
                "user_answer": user_answer,
                "correct_answer": correct,
                "is_correct": is_correct,
                "explanation": q.get("explanation", "")
            })

        # ─── Evaluate Essays via LLM ───
        essay_answers = answers.get("essay", {})
        essay_questions = quiz.get("essay", [])
        essay_evaluations = []

        if essay_answers and essay_questions:
            essay_context = ""
            for q in essay_questions:
                qnum = str(q["question_number"])
                answer = essay_answers.get(qnum, "No answer provided")
                essay_context += (
                    f"\nQuestion {q['question_number']}: {q['question']}\n"
                    f"Expected points: {', '.join(q.get('expected_points', []))}\n"
                    f"User Answer: {answer}\n"
                )

            messages = [
                {"role": "system", "content": ESSAY_EVAL_PROMPT},
                {"role": "user", "content": f"Evaluate these essay answers:\n{essay_context}"}
            ]

            try:
                eval_result = call_llm_json(messages, model=MODEL_GEMINI_PRO, max_tokens=2000)
                essay_evaluations = eval_result.get("evaluations", [])
            except Exception as e:
                logging.error(f"Essay eval LLM error: {e}")
                # Fallback: basic scoring
                for q in essay_questions:
                    qnum = str(q["question_number"])
                    answer = essay_answers.get(qnum, "")
                    essay_evaluations.append({
                        "question_number": q["question_number"],
                        "score": 5 if len(answer) > 50 else 2,
                        "feedback": "Auto-scored. LLM evaluation unavailable."
                    })

        # ─── Calculate Overall Score ───
        mc_score = (mc_correct / max(len(mc_questions), 1)) * 50  # MC = 50% weight
        essay_total = sum(e.get("score", 0) for e in essay_evaluations)
        essay_max = len(essay_questions) * 10
        essay_score = (essay_total / max(essay_max, 1)) * 50  # Essay = 50% weight
        overall_score = round(mc_score + essay_score)

        results = {
            "multiple_choice_score": mc_correct,
            "multiple_choice_total": len(mc_questions),
            "multiple_choice_details": mc_results,
            "essay_feedback": essay_evaluations,
            "overall_score": overall_score,
            "overall_total": 100,
            "pass_threshold": 70,
            "passed": overall_score >= 70
        }

        # Store results
        analysis["quiz_results"] = results
        analysis["quiz_submitted_at"] = datetime.utcnow().isoformat()
        history_container.upsert_item(analysis)

        remaining = deduct_credit(user_id)

        return success_response({
            "results": results,
            "credits_remaining": remaining
        })

    except Exception as e:
        logging.error(f"Quiz submit error: {e}")
        return error_response(str(e))
