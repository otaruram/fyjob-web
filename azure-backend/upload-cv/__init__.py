"""
Azure Function: Upload CV (v2 — Blob Storage + PNG Preview)

POST /api/upload-cv — Accept PDF as base64, convert to PNG pages, store in Blob Storage
DELETE /api/upload-cv — Delete user's CV and associated blobs
GET /api/upload-cv — Get user's CV metadata + page image URLs (cached in Cosmos)

Scale considerations (1M+ users):
- PNG URLs are cached in Cosmos DB — no Blob Storage reads on GET
- Blob Storage serves images directly (public blob access) — Azure CDN-ready
- PyMuPDF processes PDF in-memory — no temp files on disk
- Max 20 pages to prevent memory abuse from huge PDFs
- sessionStorage caching on client side avoids redundant API calls
"""
import azure.functions as func
import logging
import json
import base64
from datetime import datetime
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import (
    get_container, get_or_create_user, save_user_cv,
    delete_user_cv, upload_blob, delete_user_blobs
)

MAX_PDF_SIZE = 10 * 1024 * 1024  # 10MB
MAX_PAGES = 20  # Safety limit — prevents OOM on 200-page PDFs
PNG_DPI = 150  # Balance between quality and file size (~200KB per page)


def pdf_to_pngs(pdf_bytes: bytes, user_id: str) -> tuple:
    """Convert PDF bytes to PNG images + extract text.
    
    Returns: (text, blob_url, page_image_urls)
    Uses PyMuPDF (fitz) — pure Python, no poppler needed.
    """
    import fitz  # PyMuPDF

    doc = None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        num_pages = min(doc.page_count, MAX_PAGES)
        
        full_text = ""
        page_urls = []

        # Upload original PDF to blob
        blob_url = upload_blob(
            f"{user_id}/cv-original.pdf",
            pdf_bytes,
            content_type="application/pdf"
        )

        # Convert each page to PNG and upload
        zoom = PNG_DPI / 72  # 72 is default DPI in PDF
        matrix = fitz.Matrix(zoom, zoom)

        for page_num in range(num_pages):
            page = doc[page_num]
            
            # Extract text
            page_text = page.get_text()
            full_text += page_text + "\n\n"
            
            # Render to PNG
            pix = page.get_pixmap(matrix=matrix)
            png_bytes = pix.tobytes("png")
            pix = None  # Free memory immediately
            
            # Upload PNG to blob
            png_url = upload_blob(
                f"{user_id}/cv-page-{page_num + 1}.png",
                png_bytes,
                content_type="image/png"
            )
            page_urls.append(png_url)

        return full_text.strip(), blob_url, page_urls
    finally:
        if doc:
            doc.close()


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Upload CV function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        # ─── GET: Preview CV (returns cached URLs from Cosmos — no Blob hit) ───
        if req.method == "GET":
            user = get_or_create_user(user_id, email)
            cv_text = user.get("raw_cv_text", "")
            return success_response({
                "has_cv": bool(cv_text),
                "filename": user.get("cv_filename", ""),
                "text_preview": cv_text[:2000] if cv_text else "",
                "text_length": len(cv_text),
                "uploaded_at": user.get("cv_uploaded_at", ""),
                "credits_remaining": user.get("credits_remaining", 0),
                # v2 fields — PNG preview via Blob Storage
                "blob_url": user.get("cv_blob_url", ""),
                "page_images": user.get("cv_page_images", []),
            })

        # ─── DELETE: Remove CV + blobs ───
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
        
        # Support both modes:
        # Mode 1 (NEW): base64-encoded PDF binary → full pipeline
        # Mode 2 (LEGACY): plain text cvText → text-only (ATS Builder etc)
        
        pdf_base64 = body.get("pdfBase64", "")
        cv_text_legacy = body.get("cvText", "").strip()
        cv_filename = body.get("filename", "uploaded_cv.pdf")

        if pdf_base64:
            # ── Mode 1: Full PDF pipeline ──
            try:
                pdf_bytes = base64.b64decode(pdf_base64)
            except Exception:
                return error_response("Invalid base64 PDF data", 400)
            
            if len(pdf_bytes) > MAX_PDF_SIZE:
                return error_response(f"PDF too large. Max {MAX_PDF_SIZE // (1024*1024)}MB.", 400)
            
            if len(pdf_bytes) < 100:
                return error_response("PDF file is too small or corrupt.", 400)

            # Delete old blobs before uploading new ones
            delete_user_blobs(user_id)
            
            # Convert PDF → text + PNG pages → upload to Blob Storage
            cv_text, blob_url, page_images = pdf_to_pngs(pdf_bytes, user_id)
            
            if len(cv_text) < 50:
                return error_response(
                    "Could not extract enough text from PDF. Ensure it's not a scanned image.",
                    400
                )

            # Save everything to Cosmos (cached — GET won't hit Blob Storage)
            user = save_user_cv(user_id, cv_text, cv_filename, blob_url, page_images)
            
        elif cv_text_legacy:
            # ── Mode 2: Legacy text-only upload (ATS Builder) ──
            if len(cv_text_legacy) < 50:
                return error_response("CV text is too short. Please upload a valid CV.", 400)
            
            # Delete old blobs if any
            delete_user_blobs(user_id)
            
            user = save_user_cv(user_id, cv_text_legacy, cv_filename, "", [])
            cv_text = cv_text_legacy
            blob_url = ""
            page_images = []
        else:
            return error_response("Either pdfBase64 or cvText is required", 400)

        # Log activity
        try:
            activity_container = get_container("UserActivity")
            activity_container.create_item({
                "id": f"activity_{user_id}_{datetime.utcnow().timestamp()}",
                "userId": user_id,
                "activityType": "cv_upload",
                "metadata": {
                    "filename": cv_filename,
                    "text_length": len(cv_text),
                    "pages": len(page_images) if pdf_base64 else 0,
                    "mode": "pdf_binary" if pdf_base64 else "text_legacy"
                },
                "created_at": datetime.utcnow().isoformat()
            })
        except Exception as e:
            logging.warning(f"Failed to log CV upload: {e}")

        return success_response({
            "message": "CV uploaded successfully",
            "filename": cv_filename,
            "text_length": len(cv_text),
            "pages": len(page_images) if pdf_base64 else 0,
            "blob_url": blob_url if pdf_base64 else "",
            "page_images": page_images if pdf_base64 else [],
            "credits_remaining": user.get("credits_remaining", 0)
        })

    except Exception as e:
        logging.error(f"Upload CV error: {e}")
        return error_response(str(e))
