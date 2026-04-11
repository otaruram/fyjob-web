# AI Interview Premium Design (FYJOB)

## Goals
- Add 2 modes: `text-to-text` and `speech-to-speech`.
- Charge exactly `3 credits` per interview session.
- Use low-cost model strategy for free-tier sustainability.
- Add Redis cache and queue to avoid request collisions.
- Use Azure Speech services for STT/TTS in speech mode.

## Recommended Model Strategy (Low Cost)
- Core interviewer LLM: `Gemini 2.5 Flash` (default for all premium interview text turns).
- Optional admin override: stronger model only for manual QA/testing.
- Keep responses concise to minimize tokens.

## Minimal Context Requirement
- For Interview Lite MVP, `CV + selected analysis` is sufficient context.
- Selected analysis provides role target, gaps, and job description context.
- CV provides candidate background, projects, and skills.
- Additional sources like job history or prior interview transcripts are optional future improvements, not required for launch.

## Credit Policy
- Charge `3 credits` once at session start (`/api/interview/start`).
- Do NOT charge per turn.
- If start fails before first question is generated, auto-refund 3 credits.
- Deny start when credits < 3 (except admin).

## DB Design (Cosmos)

### Container: `InterviewSessions`
Partition key: `/userId`

Document shape:
- `id`: `interview_<userId>_<timestamp>`
- `userId`: string
- `analysisId`: string
- `mode`: `"text" | "speech"`
- `language`: `"id" | "en" | "zh"`
- `status`: `"active" | "completed" | "aborted"`
- `credits_charged`: number (default 3)
- `started_at`: ISO string
- `updated_at`: ISO string
- `ended_at`: ISO string | null
- `turn_count`: number
- `messages`: array of `{ role, content, ts }`
- `score_summary`: optional object

### Container: `InterviewTurnJobs` (optional if queue state persisted)
Partition key: `/userId`

Document shape:
- `id`: `turn_<sessionId>_<turnIndex>`
- `userId`: string
- `sessionId`: string
- `state`: `"queued" | "processing" | "done" | "failed"`
- `request_hash`: string (idempotency)
- `created_at`: ISO
- `updated_at`: ISO

## Redis Cache Design
Use Azure Cache for Redis.

### Keys
- `fyjob:interview:session:{sessionId}` -> short session snapshot (TTL 24h)
- `fyjob:interview:lock:{sessionId}` -> per-session lock (TTL 30s)
- `fyjob:interview:turncache:{sessionId}:{hash}` -> dedupe cached answer (TTL 10m)

### Usage
- Acquire lock before processing turn to avoid concurrent overlap.
- Return cached response when same turn payload hash repeats (idempotent retry).
- Persist final truth to Cosmos; Redis is acceleration layer only.

## Queue Design
Use Azure Queue Storage or Service Bus.

### Queue message
- `sessionId`
- `userId`
- `analysisId`
- `mode`
- `language`
- `turnInput` (text or transcript)
- `requestHash`

### Worker behavior
1. Validate session active.
2. Acquire Redis lock.
3. Build context from analysis + CV + previous messages.
4. Call Gemini Flash.
5. Store assistant turn in Cosmos + Redis cache.
6. Release lock.

## API Contract

### POST `/api/interview/start`
Request:
- `analysisId`
- `mode`
- `language`

Response:
- `sessionId`
- `firstQuestion`
- `credits_remaining`

### POST `/api/interview/turn`
Request:
- `sessionId`
- `answerText` (for text mode)
- `transcriptText` (for speech mode after STT)
- `requestId` (idempotency)

Response:
- `assistantResponse`
- `turnCount`
- `cached` boolean

### POST `/api/interview/end`
Request:
- `sessionId`

Response:
- `summary`
- `score`

## Azure Speech (STS) Integration
- STT: Azure Speech-to-Text for user audio -> transcript.
- TTS: Azure Text-to-Speech for assistant reply -> audio stream URL/base64.
- Cost target: use the cheapest production-safe path first.
- Prefer short request/response audio clips, mono input, and standard neural voice output.
- Avoid avatar, custom voice, long-form synthesis, and continuous streaming in MVP because they increase cost.

Speech flow:
1. FE records audio chunk.
2. Upload to backend `/api/interview/stt` (or direct to worker).
3. Backend returns transcript.
4. Transcript sent to `/api/interview/turn`.
5. Assistant text sent to `/api/interview/tts`.
6. FE plays returned audio.

## Frontend Requirements
- Mode selector: `Text to Text` / `Speech to Speech`.
- Language selector: `Indonesia` / `English` / `Chinese`.
- Queue status badge: show pending turns.
- Local cache per `analysisId + language + mode`.
- Disable feature if user has no analysis history.

## MVP Rollout Plan
1. Phase 1: text mode only (Gemini 2.5 Flash, 3 credits, Cosmos state).
2. Phase 2: add Redis lock/cache and queue worker.
3. Phase 3: enable Azure STT/TTS speech mode.
4. Phase 4: scoring rubric + premium analytics dashboard.
