"""
Azure Function: Analysis History
GET /api/history — Get user's job analysis history
DELETE /api/history — Delete an analysis and related app activity
"""
import azure.functions as func
import logging
import json
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("History function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        if req.method == "DELETE":
            try:
                body = req.get_json()
            except Exception:
                return error_response("Invalid JSON body", 400)

            analysis_id = (body or {}).get("analysisId", "").strip()
            if not analysis_id:
                return error_response("analysisId is required", 400)

            history_container = get_container("AnalysisHistory")

            # Ensure target analysis belongs to this user before delete
            try:
                analysis = history_container.read_item(item=analysis_id, partition_key=user_id)
            except Exception:
                return error_response("Analysis not found", 404)

            if analysis.get("userId") != user_id:
                return error_response("Forbidden", 403)

            deleted = {
                "analysis": 0,
                "chats": 0,
                "activity": 0,
            }

            # Delete analysis row (includes learning path / killer quiz / quiz results telemetry)
            history_container.delete_item(item=analysis_id, partition_key=user_id)
            deleted["analysis"] = 1

            # Delete related Ujang chat rows for this analysis
            try:
                chat_container = get_container("UjangChats")
                chat_rows = list(chat_container.query_items(
                    query=(
                        "SELECT c.id FROM c "
                        "WHERE c.userId = @uid AND c.analysisId = @aid"
                    ),
                    parameters=[
                        {"name": "@uid", "value": user_id},
                        {"name": "@aid", "value": analysis_id},
                    ],
                    enable_cross_partition_query=False,
                    partition_key=user_id,
                ))
                for row in chat_rows:
                    chat_container.delete_item(item=row["id"], partition_key=user_id)
                    deleted["chats"] += 1
            except Exception as e:
                logging.warning(f"Skipping chat cleanup: {e}")

            # Best-effort delete related activity telemetry if present
            try:
                activity_container = get_container("UserActivity")
                act_rows = list(activity_container.query_items(
                    query=(
                        "SELECT c.id FROM c "
                        "WHERE c.userId = @uid "
                        "AND ("
                        "  c.analysisId = @aid "
                        "  OR (IS_DEFINED(c.metadata.analysisId) AND c.metadata.analysisId = @aid)"
                        ")"
                    ),
                    parameters=[
                        {"name": "@uid", "value": user_id},
                        {"name": "@aid", "value": analysis_id},
                    ],
                    enable_cross_partition_query=False,
                    partition_key=user_id,
                ))
                for row in act_rows:
                    activity_container.delete_item(item=row["id"], partition_key=user_id)
                    deleted["activity"] += 1
            except Exception as e:
                logging.warning(f"Skipping activity cleanup: {e}")

            # Write deletion audit log for traceability
            try:
                from datetime import datetime
                activity_container = get_container("UserActivity")
                activity_container.create_item({
                    "id": f"activity_{user_id}_{datetime.utcnow().timestamp()}",
                    "userId": user_id,
                    "activityType": "analysis_delete",
                    "analysisId": analysis_id,
                    "metadata": {
                        "deleted_analysis": deleted.get("analysis", 0),
                        "deleted_chats": deleted.get("chats", 0),
                        "deleted_activity": deleted.get("activity", 0),
                    },
                    "created_at": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logging.warning(f"Failed writing delete audit log: {e}")

            return success_response({
                "message": "Analysis and related activity deleted",
                "deleted": deleted,
                "analysisId": analysis_id,
            })

        limit = int(req.params.get('limit', 10))
        offset = int(req.params.get('offset', 0))

        history_container = get_container("AnalysisHistory")

        query = f"""
            SELECT c.id, c.jobTitle, c.portal, c.matchScore,
                   c.created_at, c.gaps, c.insights, c.scamDetection,
                   IS_DEFINED(c.killer_quiz) as has_quiz,
                   IS_DEFINED(c.learning_path) as has_learning_path
            FROM c
            WHERE c.userId = @uid
            ORDER BY c.created_at DESC
            OFFSET {offset} LIMIT {limit}
        """

        analyses = list(history_container.query_items(
            query=query,
            parameters=[{"name": "@uid", "value": user_id}],
            enable_cross_partition_query=False,
            partition_key=user_id,
        ))

        return success_response(analyses)

    except Exception as e:
        logging.error(f"History error: {e}")
        return error_response(str(e))
