import { expect, test } from "@playwright/test";

const INTERVIEW_URL = "/interview?session_id=test-session-uuid&mode=single&provider=openai";

async function denyMicrophone(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
      writable: true,
    });
  });
}

async function grantMicrophone(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => new MediaStream(),
      },
      writable: true,
    });
  });
}

async function mockRealtimeStartup(
  page: import("@playwright/test").Page,
  options: { emitEvaluation?: boolean } = {}
) {
  // Stub RTCPeerConnection so connect() resolves without real WebRTC or network
  await page.addInitScript(({ emitEvaluation }) => {
    (window as unknown as Record<string, unknown>).__rtSentEvents = [];

    class FakeAudioContext {
      sampleRate = 24000;
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          smoothingTimeConstant: 0.75,
          frequencyBinCount: 128,
          getByteFrequencyData() {},
        };
      }
      close() {}
    }

    class FakeDataChannel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onopen: (() => void) | null = null;
      readyState = "open";

      constructor() {
        setTimeout(() => this.onopen?.(), 0);
        if (emitEvaluation) {
          setTimeout(() => {
            this.onmessage?.({
              data: JSON.stringify({
                type: "response.function_call_arguments.done",
                call_id: "call-eval",
                name: "get_evaluation_summary",
                arguments: JSON.stringify({ attempt_id: "attempt-1" }),
              }),
            } as MessageEvent);
          }, 50);
        }
      }

      send(data: string) {
        ((window as unknown as Record<string, unknown>).__rtSentEvents as unknown[]).push(JSON.parse(data));
      }
      close() {}
    }

    class FakeRTCPeerConnection {
      ontrack: ((e: RTCTrackEvent) => void) | null = null;
      createDataChannel() {
        const channel = new FakeDataChannel();
        (window as unknown as Record<string, unknown>).__rtDataChannel = channel;
        return channel;
      }
      addTrack() {}
      async createOffer() { return { type: "offer" as RTCSdpType, sdp: "v=0\r\n" }; }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    }
    (window as unknown as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
    (window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  }, options);

  await page.route("**/realtime/client-secret", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        client_secret: "test-secret",
        expires_at: null,
        openai_session_id: "test-openai-session",
      }),
    });
  });

  // Mock the SDP exchange so connect() succeeds instead of throwing
  await page.route("https://api.openai.com/v1/realtime/calls", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/sdp", body: "v=0\r\n" });
  });
}

async function emitRealtimeEvent(page: import("@playwright/test").Page, event: Record<string, unknown>) {
  await page.evaluate((evt) => {
    const channel = (window as unknown as { __rtDataChannel?: { onmessage?: (e: { data: string }) => void } })
      .__rtDataChannel;
    channel?.onmessage?.({ data: JSON.stringify(evt) });
  }, event);
}

test("interview page shows mic permission overlay on load", async ({ page }) => {
  await page.goto(INTERVIEW_URL);

  await expect(page.locator("text=準備好了嗎？")).toBeVisible();
  await expect(page.locator("button", { hasText: "開始面試" })).toBeVisible();
});

test("denied mic shows error overlay", async ({ page }) => {
  await denyMicrophone(page);

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "開始面試" }).click();

  await expect(page.locator("text=麥克風存取被拒")).toBeVisible();
});

test("back button after mic denial navigates to home", async ({ page }) => {
  await denyMicrophone(page);

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "開始面試" }).click();
  await expect(page.locator("text=麥克風存取被拒")).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();

  await expect(page).toHaveURL("/");
});

test("can switch between transcript and eval tabs", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page);

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "開始面試" }).click();
  await expect(page.locator("text=準備好了嗎？")).not.toBeVisible({ timeout: 5000 });

  const evalTab = page.locator("button", { hasText: "評分結果" });
  const transcriptTab = page.locator("button", { hasText: "對話紀錄" });

  await evalTab.click();
  await expect(evalTab).toHaveCSS("font-weight", "600");

  await transcriptTab.click();
  await expect(transcriptTab).toHaveCSS("font-weight", "600");
});

test("end session button navigates back to home", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page);

  await page.route("**/sessions/*/complete", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session_id: "test-session-uuid", status: "completed" }),
    });
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "開始面試" }).click();
  await expect(page.locator("text=準備好了嗎？")).not.toBeVisible({ timeout: 5000 });

  await page.locator("button", { hasText: "結束面試" }).click();

  await expect(page).toHaveURL("/");
});

test("keeps answer controls visible after evaluation completes", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page, { emitEvaluation: true });

  await page.route("**/attempts/attempt-1/result", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attempt_id: "attempt-1",
        status: "completed",
        score: 82,
        evaluation: null,
      }),
    });
  });
  await page.route("**/attempts/attempt-1/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        score: 82,
        summary: "回答摘要",
        missing_points: ["需要補充交易隔離級別"],
        next_focus: ["加入具體系統設計取捨"],
        ideal_answer: "完整回答應說明索引、查詢計畫、快取策略與一致性取捨。",
        provider: "test",
        model: "test-model",
      }),
    });
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "開始面試" }).click();

  await expect(page.locator("text=您的回答逐字稿")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("text=評分摘要")).toBeVisible();
  await expect(page.getByText("回答摘要").first()).toBeVisible();
  await expect(page.getByText("需要補充交易隔離級別")).toBeVisible();
  await expect(page.getByText("加入具體系統設計取捨")).toBeVisible();
  const feedbackCard = page.locator("div", { hasText: "AI 詳細反饋" }).first();
  await expect(feedbackCard.getByText("參考答案")).toBeVisible();
  await expect(page.getByText("完整回答應說明索引、查詢計畫、快取策略與一致性取捨。")).toBeVisible();
  await expect(page.getByRole("button", { name: /開啟麥克風|靜音/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "送出答案" })).toBeVisible();
  await expect(page.locator("button", { hasText: "下一題 →" }).first()).toBeVisible();
});

test("realtime answer submission keeps Chinese transcript and shows feedback text", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page);

  let submittedBody: { transcript?: string } | null = null;
  await page.route("**/attempts", async (route) => {
    submittedBody = route.request().postDataJSON() as { transcript?: string };
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ attempt_id: "attempt-123", status: "pending_evaluation" }),
    });
  });

  await page.goto(INTERVIEW_URL);
  await page.getByRole("button", { name: "開始面試" }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { __rtDataChannel?: unknown }).__rtDataChannel));

  await emitRealtimeEvent(page, {
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "我會先用資料庫索引縮小查詢範圍，並確認查詢計畫。",
  });

  await emitRealtimeEvent(page, {
    type: "response.function_call_arguments.done",
    call_id: "call-1",
    name: "mark_answer_completed",
    arguments: JSON.stringify({
      session_id: "test-session-uuid",
      question_id: "00000000-0000-0000-0000-000000000001",
      transcript: "I would use database indexes and inspect the query plan.",
    }),
  });

  await expect.poll(() => submittedBody?.transcript).toBe("我會先用資料庫索引縮小查詢範圍，並確認查詢計畫。");
  await expect(page.getByText("我會先用資料庫索引縮小查詢範圍，並確認查詢計畫。").first()).toBeVisible();

  await emitRealtimeEvent(page, {
    type: "response.output_text.done",
    text: "這段回答有提到索引與查詢計畫，但可以補充取捨。",
  });

  await expect(page.getByText("這段回答有提到索引與查詢計畫，但可以補充取捨。").first()).toBeVisible();
});
