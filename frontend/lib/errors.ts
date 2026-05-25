export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ParsedError {
  title: string;
  message: string;
}

export function parseConnectionError(err: unknown): ParsedError {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return { title: "連線發生錯誤", message: "API 使用額度不足，請前往 OpenAI 平台充值後再試。" };
    }
    if (err.status === 404) {
      return { title: "連線發生錯誤", message: "指定的 AI 模型不存在，請聯絡管理員。" };
    }
    if (err.status === 401 || err.status === 403) {
      return { title: "連線發生錯誤", message: "認證失敗，請確認 API 金鑰設定正確。" };
    }
    if (err.status >= 500) {
      return { title: "連線發生錯誤", message: `伺服器發生錯誤（${err.status}），請稍後再試。` };
    }
    return { title: "連線發生錯誤", message: `請求失敗（${err.status}），請稍後再試。` };
  }
  if (err instanceof TypeError) {
    return { title: "無法連線到伺服器", message: "無法連線到後端伺服器，請確認伺服器已啟動後重試。" };
  }
  return { title: "發生未知錯誤", message: "發生未預期的錯誤，請重新整理頁面。" };
}
