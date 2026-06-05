// KEEP IN SYNC WITH backend/app/routers/realtime.py :: TRANSCRIPTION_BASE_PROMPT
export const TRANSCRIPTION_BASE_PROMPT =
  "這是一場後端工程師中文技術面試，應試者使用台灣繁體中文回答。" +
  "請完整保留英文術語的原文拼寫，不要翻譯成中文、不要替換成其他相近詞、" +
  "不要轉成拼音或假名。聽不清楚時保留原狀，不要猜測。";

export function buildTranscriptionPrompt(keywords: string[]): string {
  if (keywords.length === 0) return TRANSCRIPTION_BASE_PROMPT;
  return `${TRANSCRIPTION_BASE_PROMPT} 本題可能會出現的英文術語：${keywords.join(", ")}。`;
}
