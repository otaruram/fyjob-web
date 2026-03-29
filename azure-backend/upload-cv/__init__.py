"""
Azure Function: Upload CV
POST /api/upload-cv — Save/replace user's CV (1 CV per user, old one gets deleted)
DELETE /api/upload-cv — Delete user's CV
GET /api/upload-cv — Get user's CV preview
"""
import azure.functions as func
import logging
import json
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import get_container, get_or_create_user, save_user_cv, delete_user_cv


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Upload CV function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        # ─── GET: Preview CV ───
        if req.method == "GET":
            user = get_or_create_user(user_id, email)
            cv_text = user.get("raw_cv_text", "")
            return success_response({
                "has_cv": bool(cv_text),
                "filename": user.get("cv_filename", ""),
                "text_preview": cv_text[:2000] if cv_text else "",
                "text_length": len(cv_text),
                "uploaded_at": user.get("cv_uploaded_at", ""),
                "credits_remaining": user.get("credits_remaining", 0)
            })

        # ─── DELETE: Remove CV ───
        if req.method == "DELETE":
            user = delete_user_cv(user_id)
            # Log activity
            try:
                activity_container = get_container("UserActivity")
                activity_container.create_item({
                    "id": f"activity_{user_id}_{datetime.utcnow().timestamp()}",
                    "userId": user_id,
                    "activityType": "cv_delete",
                    "created_at": datetime.utcnow().isoformat()
                })
            except Exception:
                pass
            return success_response({
                "message": "CV deleted successfully",
                "credits_remaining": user.get("credits_remaining", 0)
            })

        # ─── POST: Upload/Replace CV ───
        body = req.get_json()
        cv_text = body.get("cvText", "").strip()
        cv_filename = body.get("filename", "uploaded_cv.pdf")

        if not cv_text:
            return error_response("cvText is required", 400)

        if len(cv_text) < 50:
            return error_response("CV text is too short. Please upload a valid CV.", 400)

        # Replace old CV (delete + save new one in single operation)
        user = save_user_cv(user_id, cv_text, cv_filename)

        # Log activity
        try:
            activity_container = get_container("UserActivity")
            activity_container.create_item({
                "id": f"activity_{user_id}_{datetime.utcnow().timestamp()}",
                "userId": user_id,
                "activityType": "cv_upload",
                "metadata": {"filename": cv_filename, "text_length": len(cv_text)},
                "created_at": datetime.utcnow().isoformat()
            })
        except Exception as e:
            logging.warning(f"Failed to log CV upload: {e}")

        return success_response({
            "message": "CV uploaded successfully (previous CV replaced)",
            "filename": cv_filename,
            "text_length": len(cv_text),
            "credits_remaining": user.get("credits_remaining", 0)
        })

    except Exception as e:
        logging.error(f"Upload CV error: {e}")
        return error_response(str(e))
