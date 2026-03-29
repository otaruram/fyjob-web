"""
Shared LLM Service
Wraps Sumopod AI API calls for both Claude Haiku and Gemini Pro models.
Base URL: https://ai.sumopod.com/v1/chat/completions
"""
import os
import json
import logging
import requests
from typing import Dict, Any, Optional, List
from .cosmos_client import get_secret

SUMOPOD_BASE_URL = "https://ai.sumopod.com/v1/chat/completions"

# Model routing
MODEL_GEMINI_FLASH = "gemini/gemini-2.5-flash"      # Free users
MODEL_CLAUDE_HAIKU = "claude-haiku-4-5"           # Pro users (future)
MODEL_GEMINI_PRO = "gemini/gemini-2.5-pro"        # Pro users (future)
MODEL_GEMINI_3_PRO = "gemini/gemini-3-pro-preview" # Admin only


def _get_api_key() -> str:
    key = get_secret("sumopod-api-key") or os.environ.get("SUMOPOD_API_KEY")
    if not key:
        raise ValueError("Sumopod API key not configured")
    return key


def call_llm(
    messages: List[Dict[str, str]],
    model: str = MODEL_CLAUDE_HAIKU,
    max_tokens: int = 2000,
    temperature: float = 0.7,
    retry_count: int = 2
) -> str:
    """
    Call Sumopod LLM API with retry logic.
    Returns the raw text content from the model.
    """
    api_key = _get_api_key()

    for attempt in range(retry_count):
        try:
            response = requests.post(
                SUMOPOD_BASE_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens
                },
                timeout=60
            )

            if response.status_code != 200:
                logging.error(f"LLM API error (attempt {attempt+1}): {response.status_code} - {response.text[:300]}")
                if attempt < retry_count - 1:
                    continue
                raise RuntimeError(f"LLM API returned {response.status_code}")

            data = response.json()
            return data["choices"][0]["message"]["content"]

        except requests.exceptions.Timeout:
            logging.error(f"LLM API timeout (attempt {attempt+1})")
            if attempt < retry_count - 1:
                continue
            raise
        except Exception as e:
            logging.error(f"LLM call failed (attempt {attempt+1}): {e}")
            if attempt < retry_count - 1:
                continue
            raise


def call_llm_json(
    messages: List[Dict[str, str]],
    model: str = MODEL_CLAUDE_HAIKU,
    max_tokens: int = 2000,
    temperature: float = 0.7
) -> Dict[str, Any]:
    """
    Call LLM and parse the response as JSON.
    Handles markdown code blocks wrapping.
    """
    content = call_llm(messages, model, max_tokens, temperature)

    # Strip markdown code blocks
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
        content = content.split("```")[1].split("```")[0].strip()
    else:
        content = content.strip()

    try:
        try:
            from json_repair import loads as json_repair_loads
            return json_repair_loads(content)
        except ImportError:
            logging.warning("json-repair not found, using standard json fallback")
            return json.loads(content)
    except Exception as e:
        logging.error(f"Failed to parse LLM JSON response: {e}\nContent: {content[:500]}")
        raise ValueError(f"LLM returned invalid JSON: {e}")

