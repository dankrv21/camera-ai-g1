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
          model: "claude-opus-4-8",
          max_tokens: 150,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Data } },
            { type: "text", text: `You are an expert in every academic subject including accounting, finance, economics, math, science, history, law, and all others. Analyze every detail in this image: all text, numbers, charts, graphs, tables, journal entries, T-accounts, equations, diagrams.

If a question is visible in any form, think carefully and give the CORRECT answer:
- Multiple choice: read ALL options carefully, pick the correct one, reply ONLY with letter/number and answer, example: B) Accounts Receivable
- No options visible: answer using your knowledge, reply ONLY the answer in under 12 words
- Journal entry or T-account: reply ONLY correct debit and credit, example: Debit Cash $500, Credit Revenue $500
- Math or calculation: solve fully, reply ONLY final answer, example: Net Income = $12,400
- Fill in blank: reply ONLY the correct word or value
- True/False: reply ONLY True or False
- Graph or chart: read the visual data carefully, reply ONLY the correct answer

Rules: NEVER describe the image. NEVER use markdown. NEVER explain reasoning. Accuracy matters most.
If no question exists: reply NONE` }
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
          model: "claude-opus-4-8",
          max_tokens: 200,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Data } },
            { type: "text", text: prompt?.trim() || "You are an expert in all academic subjects. Answer the question in this image with ONLY the correct answer. No descriptions, no markdown, no explanations. If multiple choice give only the correct option." }
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
