# Realtime Traditional Chinese Voice Design

## Goal

Change the OpenAI Realtime interviewer voice from the current `coral` voice to `cedar`, with a natural and calm style suitable for Traditional Chinese technical interview practice.

## Current Context

The Realtime session is created by `backend/app/routers/realtime.py` through `_build_realtime_session_config()`. The current output voice is configured as:

```python
"output": {"voice": "coral"}
```

The same route also builds the interviewer system prompt. Existing prompt rules already require Traditional Chinese conversation and preserve the candidate's Traditional Chinese transcript.

## Recommended Approach

Use the built-in OpenAI Realtime voice `cedar` as the fixed output voice, and add prompt guidance for a natural, calm Traditional Chinese interviewer style.

This keeps the change small and avoids adding configuration that the product does not currently need. OpenAI voice names are not strict gender labels, so the implementation should not claim or prompt for a guaranteed gendered voice.

## Behavior

The AI interviewer should:

- Speak in Traditional Chinese for the whole interview.
- Use Taiwan-friendly wording and avoid Simplified Chinese or China-specific phrasing.
- Sound natural, calm, and professional.
- Keep a moderate speaking speed suitable for interview practice.
- Continue to follow the existing answer-submission workflow and transcript-preservation rules.

## Implementation Scope

Update `backend/app/routers/realtime.py`:

- Change `audio.output.voice` from `coral` to `cedar`.
- Add one system prompt rule describing the desired Traditional Chinese voice style without gendered voice claims.

Update `backend/tests/test_realtime.py`:

- Add an assertion that `_build_realtime_session_config("single")["audio"]["output"]` is `{"voice": "cedar"}`.

## Out Of Scope

- No frontend controls for selecting voices.
- No environment variable for voice selection.
- No migration or database change.
- No changes to WebRTC connection handling, VAD behavior, transcript event handling, or evaluation flow.

## Testing

Run the backend realtime unit test:

```bash
cd backend && python -m pytest tests/test_realtime.py -v
```

If available, manually start an interview session and confirm the first spoken question uses the new voice style. Manual voice confirmation is useful because automated tests can verify configuration but cannot judge perceived voice quality or Traditional Chinese naturalness.

## Risks

OpenAI's built-in voice names do not guarantee a strict gender category. If `cedar` does not sound suitable in manual testing, switch to another supported Realtime voice and keep the same test pattern.
