import { ApiError } from "./errors";

const API_URL = "/api";
const TOKEN = process.env.NEXT_PUBLIC_INTERVIEW_TOKEN ?? process.env.INTERVIEW_TOKEN ?? "";

function authHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `HTTP_${res.status}`, `API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// --- Sessions ---

export interface Session {
  session_id: string;
  mode: string;
  eval_provider: string;
  status: string;
  started_at: string;
}

export function createSession(mode: string, eval_provider: string): Promise<Session> {
  return apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ mode, eval_provider }),
  });
}

export function completeSession(sessionId: string): Promise<{ session_id: string; status: string }> {
  return apiFetch(`/sessions/${sessionId}/complete`, { method: "POST" });
}

export function getSessionSummary(sessionId: string): Promise<SessionSummary> {
  return apiFetch(`/sessions/${sessionId}/summary`);
}

export interface SessionSummary {
  session_id: string;
  mode: string;
  status: string;
  total_questions: number;
  average_score: number;
  attempts: Array<{ attempt_id: string; question_id: string; score: number | null; summary: string | null }>;
}

// --- Questions ---

export interface NextQuestion {
  question_id: string;
  question_text: string;
  category: string;
  difficulty: string;
  tags: string[];
  transcription_keywords: string[];
  sm2: {
    ease_factor: number | null;
    interval_days: number | null;
    next_review_at: string | null;
    last_score: number | null;
  };
}

export interface QuestionSummary {
  question_id: string;
  question_text: string;
  category: string;
  difficulty: string;
  tags: string[];
  sm2: { last_score: number | null };
}

export function listQuestions(category?: string, difficulty?: string): Promise<QuestionSummary[]> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  const qs = params.toString();
  return apiFetch(`/questions${qs ? `?${qs}` : ""}`);
}

export interface QuestionDetailKeyPoint {
  point?: string;
  weight?: number;
  [key: string]: unknown;
}

export interface QuestionDetail {
  question_id: string;
  question_text: string;
  category: string;
  difficulty: string;
  tags: string[];
  reference_answer: string;
  key_points: QuestionDetailKeyPoint[];
  common_mistakes: string[];
}

export function getQuestion(id: string): Promise<QuestionDetail> {
  return apiFetch(`/questions/${id}`);
}

export function getNextQuestion(
  sessionId: string,
  mode: string,
  category?: string,
  difficulty?: string,
  questionId?: string
): Promise<NextQuestion> {
  const params = new URLSearchParams({ session_id: sessionId, mode });
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  if (questionId) params.set("question_id", questionId);
  return apiFetch(`/questions/next?${params}`);
}

// --- Attempts ---

export interface AttemptCreated {
  attempt_id: string;
  status: string;
  transcript: string | null;
}

export function createAttempt(
  sessionId: string,
  questionId: string,
  transcript: string
): Promise<AttemptCreated> {
  return apiFetch("/attempts", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, question_id: questionId, transcript }),
  });
}

export interface AttemptResult {
  attempt_id: string;
  status: string;
  score: number | null;
  evaluation: EvaluationResult | null;
}

export interface EvaluationResult {
  score: number;
  summary: string;
  missing_points: string[];
  next_focus: string[];
  ideal_answer?: string;
  provider: string;
  model: string;
}

export function getAttemptResult(attemptId: string): Promise<AttemptResult> {
  return apiFetch(`/attempts/${attemptId}/result`);
}

export interface AttemptSummary {
  score: number;
  summary: string;
  missing_points: string[];
  next_focus: string[];
  ideal_answer?: string;
}

export function getAttemptSummary(attemptId: string): Promise<AttemptSummary> {
  return apiFetch(`/attempts/${attemptId}/summary`);
}

// --- Realtime ---

export interface ClientSecret {
  client_secret: string;
  expires_at: string | null;
  openai_session_id: string;
}

export function createClientSecret(
  sessionId: string,
  pinnedQuestionId?: string,
): Promise<ClientSecret> {
  const body: Record<string, string> = { session_id: sessionId };
  if (pinnedQuestionId) {
    body.pinned_question_id = pinnedQuestionId;
  }
  return apiFetch("/realtime/client-secret", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Polling helper ---

export async function pollAttemptResult(
  attemptId: string,
  intervalMs = 2000,
  timeoutMs = 30000
): Promise<AttemptResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getAttemptResult(attemptId);
    if (result.status === "completed" || result.status === "failed") {
      return result;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Polling timeout: evaluation did not complete in 30 seconds");
}
