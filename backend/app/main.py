from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import attempts, debug, questions, realtime, sessions

app = FastAPI(title="Interview Practice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(questions.router)
app.include_router(attempts.router)
app.include_router(realtime.router)
app.include_router(debug.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
