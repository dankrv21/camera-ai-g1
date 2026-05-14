import { AppServer, AppSession } from "@mentra/sdk";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
let activeSession: AppSession | null = null;

class CameraAIApp extends AppServer {
  constructor() {
    super({
      packageName: process.env.PACKAGE_NAME!,
      apiKey: process.env.MENTRA_API_KEY!,
      port: parseInt(process.env.PORT || "3000"),
    });

    this.app.use(express.json({ limit: "20mb" }));
    this.app.use(express.static(path.join(process.cwd(), "public")));
    this.app.get('/webview', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });

    this.app.post("/scan", async (req, res) => {
      if (!activeSession) { res.json({ status: "no_session" }); return; }
      const { imageBase64 } = req.body;
      if (!imageBase64) { res.json({ status: "no_image" }); return; }
      try {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 150,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Data } },
            { type: "text", text: `You are answering questions from photos. Rules:
1. NEVER describe the image or use markdown or headers
2. If you see a question OR a term/definition card OR fill-in-the-blank — answer it
3. For multiple choice or options (even numbered 1 2 3 4): reply ONLY with the correct number or letter and the answer, example: 1) Structure
4. For open ended: reply ONLY the answer in under 8 words
5. If truly no question exists: reply NONE` }
          ]}],
        });
        const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "NONE";
        if (raw === "NONE" || raw.toUpperCase().startsWith("NONE")) { res.json({ status: "no_question" }); return; }
        activeSession.layouts.showTextWall(raw);
        res.json({ status: "ok", answer: raw });
      } catch (err: any) {
        console.error("Scan error:", err.message);
        res.status(500).json({ status: "error", message: err.message });
      }
    });

    this.app.post("/photo", async (req, res) => {
      if (!activeSession) { res.json({ error: "No active glasses session." }); return; }
      const { imageBase64, prompt } = req.body;
      if (!imageBase64) { res.json({ error: "No image." }); return; }
      try {
        activeSession.layouts.showTextWall("Analyzing...");
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Data } },
            { type: "text", text: prompt?.trim() || "Answer the question in this image directly. No descriptions, no markdown, just the answer. If multiple choice give the correct option only." }
          ]}],
        });
        const answer = response.content[0].type === "text" ? response.content[0].text : "No answer.";
        activeSession.layouts.showTextWall(answer);
        res.json({ ok: true, answer });
      } catch (err: any) {
        activeSession?.layouts.showTextWall("Error. Try again.");
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get("/status", (_req, res) => {
      res.json({ glassesConnected: !!activeSession });
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    console.log(`Session started: ${sessionId}`);
    activeSession = session;
    session.layouts.showTextWall("Camera AI ready.");
    session.events.onDisconnected(() => {
      if (activeSession === session) activeSession = null;
    });
  }
}

new CameraAIApp().start();
console.log("Camera AI running on port 3000.");
