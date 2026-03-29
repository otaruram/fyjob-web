"""
Azure Function: Analysis History
GET /api/history — Get user's job analysis history
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
        limit = int(req.params.get('limit', 10))
        offset = int(req.params.get('offset', 0))

        history_container = get_container("AnalysisHistory")

        query = f"""
            SELECT c.id, c.jobTitle, c.portal, c.matchScore,
                   c.created_at, c.gaps, c.insights, c.scamDetection,
                   IS_DEFINED(c.killer_quiz) as has_quiz,
                   IS_DEFINED(c.learning_path) as has_learning_path
            FROM c
            WHERE c.userId = '{user_id}'
            ORDER BY c.created_at DESC
            OFFSET {offset} LIMIT {limit}
        """

        analyses = list(history_container.query_items(
            query=query, enable_cross_partition_query=True
        ))

        return success_response(analyses)

    except Exception as e:
        logging.error(f"History error: {e}")
        return error_response(str(e))
