/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// === Simple file-based persistent storage ===
const DATA_FILE = path.join("/tmp", "dailymate-tasks.json");

interface StoredTask {
  title: string;
  deadline: string;
  priority_rank: number;
  reason: string;
  estimated_minutes: number;
  energy_level: string;
  createdAt: string;
}

interface AgentLogEntry {
  timestamp: string;
  message: string;
}

function loadData(): { tasks: StoredTask[]; agentLog: AgentLogEntry[] } {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load data file:", e);
  }
  return { tasks: [], agentLog: [] };
}

function saveData(data: { tasks: StoredTask[]; agentLog: AgentLogEntry[] }) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to save data file:", e);
  }
}

function addAgentLog(message: string) {
  const data = loadData();
  data.agentLog.unshift({ timestamp: new Date().toISOString(), message });
  data.agentLog = data.agentLog.slice(0, 20); // keep last 20 entries
  saveData(data);
}

const SYSTEM_INSTRUCTION = `You are DailyMate — an intelligent, voice-first daily task companion built for people worldwide: students, professionals, and entrepreneurs.

=== LANGUAGE BEHAVIOR ===
- Automatically detect whatever language or style the user writes in (English, Hindi, Hinglish, Spanish, French, Japanese, Arabic, or any other language).
- ALWAYS respond in the EXACT SAME language and tone the user used.
- Sound like a real, warm local person — not a robotic translator.

=== CORE BEHAVIOR ===
You are AGENTIC, not passive. Break down the user's message into individual tasks, assign each a priority, and decide the best order based on deadlines and the user's stated energy level.

Rules:
1. Extract every distinct task mentioned, with its deadline if stated.
2. Detect the user's energy/mood (high, medium, low, tired, stressed) — from explicit statements OR from tone/word choice if not explicitly stated.
3. Order tasks: if energy is high, hardest/most important first. If energy is low/tired, easier quick-win tasks first.
4. For each task, write a short one-line reason for its position (in the user's language).
5. Estimate a realistic duration in minutes (estimated_minutes) for each task.
6. Write one short, warm "next_action" message summarizing what to do right now (in the user's language, 2-3 sentences, conversational, no markdown — this gets read aloud).
7. The user's message will start with [CURRENT TIME: <day, time>]. Use this to judge whether a stated deadline has already passed relative to now, and assume the next occurrence if so.
8. If the user explicitly states their energy level, use exactly that energy level.

=== PROACTIVE BEHAVIOR ===
9. If the user's message includes [TASK AGE INFO] showing a task has survived multiple re-planning rounds, proactively call this out in next_action.
10. Proactively mention logical dependencies between tasks in the reason field.
11. If tasks clearly cannot fit before deadlines, proactively warn in next_action.`;

// Retries a Gemini call with exponential backoff if rate-limited, trying multiple models to bypass quota exhaustion
async function generateContentWithRetry(prompt: string, configOverrides: { isJson?: boolean; schema?: any } = {}, maxRetries = 2) {
  let lastError: unknown;
  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempting Gemini generation using model: ${model} (attempt ${attempt}/${maxRetries})...`);
        const config: any = {
          systemInstruction: SYSTEM_INSTRUCTION,
        };
        if (configOverrides.isJson) {
          config.responseMimeType = "application/json";
        }
        if (configOverrides.schema) {
          config.responseSchema = configOverrides.schema;
        }

        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        console.warn(`Gemini API attempt failed for model ${model} (attempt ${attempt}/${maxRetries}):`, error.message || error);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 800));
        }
      }
    }
  }

  throw lastError;
}

function getISTDate(): Date {
  const now = new Date();
  const utcMillis = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMillis + 5.5 * 60 * 60000);
}

function getISTTimeString(): string {
  const istTime = getISTDate();
  return istTime.toLocaleString("en-IN", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: true });
}

// === High-Performance Local Offline Fallback Planner ===
function getFallbackDailyPlan(userInput: string): any {
  let energy_level = "Balanced";
  
  // Extract custom energy selection from prompt prefix if present
  const energyMatch = userInput.match(/\[USER-SELECTED ENERGY LEVEL:\s*([^.\]]+)/i);
  if (energyMatch) {
    energy_level = energyMatch[1].trim();
  } else {
    const lowerInput = userInput.toLowerCase();
    if (lowerInput.includes("high energy") || lowerInput.includes("flame") || lowerInput.includes("high")) {
      energy_level = "High Energy";
    } else if (lowerInput.includes("tired") || lowerInput.includes("coffee") || lowerInput.includes("low")) {
      energy_level = "Tired / Low";
    } else if (lowerInput.includes("stressed") || lowerInput.includes("one thing") || lowerInput.includes("stress")) {
      energy_level = "Stressed";
    }
  }

  // Strip instruction metadata prefixes
  let cleanInput = userInput
    .replace(/\[USER-SELECTED ENERGY LEVEL:[^\]]+\]/gi, "")
    .replace(/\[CURRENT TIME:[^\]]+\]/gi, "")
    .trim();

  // Extract tasks using separators
  const splitters = [/\n+/, /;\s*/, /,\s*and\s+/i, /\s+and\s+/i, /\s+then\s+/i, /\s+after that\s+/i];
  let rawTasks: string[] = [cleanInput];

  for (const splitter of splitters) {
    const temp: string[] = [];
    for (const t of rawTasks) {
      const parts = t.split(splitter);
      temp.push(...parts);
    }
    rawTasks = temp;
  }

  const tasksList: string[] = [];
  const seen = new Set<string>();

  for (let t of rawTasks) {
    t = t.trim()
      .replace(/^[-*•\d.]+\s*/, "")
      .replace(/^(I need to|I have to|to|please|want to|wanna|should)\s+/i, "")
      .trim();
    
    if (t.length > 2) {
      t = t.charAt(0).toUpperCase() + t.slice(1);
      const lower = t.toLowerCase();
      if (!seen.has(lower) && lower.length > 3) {
        seen.add(lower);
        tasksList.push(t);
      }
    }
  }

  if (tasksList.length === 0 && cleanInput.length > 0) {
    tasksList.push(cleanInput);
  }
  if (tasksList.length === 0) {
    tasksList.push("Plan my day", "Take a short screen break");
  }

  const tasks = tasksList.map((title, i) => {
    let estimated_minutes = 30;
    const hourMatch = title.match(/(\d+)\s*(hours|hour|hr|hrs)/i);
    const minMatch = title.match(/(\d+)\s*(minutes|minute|min|mins)/i);
    if (hourMatch) {
      estimated_minutes = parseInt(hourMatch[1]) * 60;
    } else if (minMatch) {
      estimated_minutes = parseInt(minMatch[1]);
    } else {
      const titleLower = title.toLowerCase();
      if (titleLower.includes("project") || titleLower.includes("study") || titleLower.includes("work") || titleLower.includes("exam") || titleLower.includes("assignment") || titleLower.includes("history") || titleLower.includes("math")) {
        estimated_minutes = 60;
      } else if (titleLower.includes("exercise") || titleLower.includes("gym") || titleLower.includes("workout") || titleLower.includes("run")) {
        estimated_minutes = 45;
      } else if (titleLower.includes("read") || titleLower.includes("book")) {
        estimated_minutes = 30;
      } else if (titleLower.includes("mail") || titleLower.includes("call") || titleLower.includes("lunch") || titleLower.includes("eat") || titleLower.includes("tea")) {
        estimated_minutes = 20;
      }
    }

    let deadline = "";
    const byMatch = title.match(/(by|before|at)\s+([\d:]+\s*(am|pm)?|\w+\s+evening|\w+\s+morning|tonight|today)/i);
    if (byMatch) {
      deadline = byMatch[2];
    }

    let reason = "Scheduled based on optimal daytime focus slots.";
    if (energy_level.includes("Low") || energy_level.includes("Tired")) {
      reason = "Easy quick win to keep your momentum high without draining you.";
    } else if (energy_level.includes("Stressed")) {
      reason = "Step-by-step action to reduce stress levels and maintain steady focus.";
    } else if (energy_level.includes("High")) {
      reason = "Demanding task placed early to crush while energy is at peak!";
    }

    return {
      title,
      deadline,
      priority_rank: i + 1,
      reason,
      estimated_minutes
    };
  });

  if (energy_level.includes("Low") || energy_level.includes("Tired") || energy_level.includes("Stressed")) {
    tasks.sort((a, b) => a.estimated_minutes - b.estimated_minutes);
  } else {
    tasks.sort((a, b) => b.estimated_minutes - a.estimated_minutes);
  }

  tasks.forEach((task, index) => {
    task.priority_rank = index + 1;
  });

  let next_action = "Let's tackle these tasks one step at a time.";
  if (energy_level.includes("Low") || energy_level.includes("Tired")) {
    next_action = "Since energy levels are gentle, let's start with some easy, quick tasks. Take plenty of breaks!";
  } else if (energy_level.includes("Stressed")) {
    next_action = "Let's take things one small step at a time. Take a deep breath and focus on our first quick-win task!";
  } else if (energy_level.includes("High")) {
    next_action = "Your energy is high! We've prioritized your most significant tasks first so you can crush them early!";
  }

  return {
    energy_level,
    next_action: `[Eco Mode] ${next_action}`,
    tasks
  };
}

// Helper to parse time strings into decimal hours (e.g. "5:30 pm" -> 17.5)
function parseTimeToDecimal(timeStr: string): number | null {
  if (!timeStr) return null;
  const s = timeStr.toLowerCase().trim();
  
  if (s.includes("morning")) return 9.0;
  if (s.includes("afternoon")) return 14.0;
  if (s.includes("evening")) return 18.0;
  if (s.includes("night") || s.includes("tonight")) return 21.0;

  const match = s.match(/(\d+)(?::(\d+))?\s*(am|pm)?/);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const ampm = match[3];

    if (ampm === "pm" && hours < 12) {
      hours += 12;
    } else if (ampm === "am" && hours === 12) {
      hours = 0;
    }
    
    return hours + minutes / 60;
  }
  return null;
}

// === Main planning endpoint ===
app.post("/api/dailymate", async (req, res) => {
  try {
    const { userInput } = req.body;

    if (!userInput || !userInput.trim()) {
      return res.status(400).json({ error: "Input is empty" });
    }

    const fullPrompt = `[CURRENT TIME: ${getISTTimeString()}] ${userInput}`;
    const response = await generateContentWithRetry(
      fullPrompt,
      {
        isJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            energy_level: { type: Type.STRING },
            next_action: { type: Type.STRING },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  deadline: { type: Type.STRING },
                  priority_rank: { type: Type.INTEGER },
                  reason: { type: Type.STRING },
                  estimated_minutes: { type: Type.INTEGER },
                },
                required: ["title", "priority_rank", "reason", "estimated_minutes"],
              },
            },
          },
          required: ["energy_level", "next_action", "tasks"],
        }
      }
    );
    const data = JSON.parse(response.text);

    // Persist tasks to storage so the background agent can see them
    const stored = loadData();
    stored.tasks = data.tasks.map((t: any) => ({
      ...t,
      energy_level: data.energy_level,
      createdAt: new Date().toISOString(),
    }));
    saveData(stored);
    addAgentLog(`Plan updated: ${data.tasks.length} task(s) prioritized at energy level "${data.energy_level}".`);

    res.json(data);
  } catch (error) {
    console.error("Gemini API error, falling back to offline planner:", error);
    try {
      const { userInput } = req.body;
      const fallbackData = getFallbackDailyPlan(userInput || "");
      
      const stored = loadData();
      stored.tasks = fallbackData.tasks.map((t: any) => ({
        ...t,
        energy_level: fallbackData.energy_level,
        createdAt: new Date().toISOString(),
      }));
      saveData(stored);
      addAgentLog(`[Eco Mode] Plan generated locally. Running offline to bypass API rate-limiting.`);

      res.json(fallbackData);
    } catch (fallbackErr) {
      console.error("Local fallback also failed:", fallbackErr);
      res.status(500).json({ error: "Something went wrong while compiling your plan." });
    }
  }
});

// === Agent self-check endpoint — 100% deterministic local rule-based check to consume 0 quota ===
app.get("/api/agent-check", (req, res) => {
  try {
    const stored = loadData();

    if (!stored.tasks || stored.tasks.length === 0) {
      return res.json({ message: "No active tasks to check.", log: stored.agentLog });
    }

    const istNow = getISTDate();
    const currentHour = istNow.getHours() + istNow.getMinutes() / 60;
    
    let message = "✅ Everything is running perfectly on your timeline. Keep it up!";
    let warningFound = false;

    // Check deadlines
    for (const t of stored.tasks) {
      const deadlineText = `${t.deadline || ""} ${t.title}`;
      const deadlineHour = parseTimeToDecimal(deadlineText);

      if (deadlineHour !== null) {
        if (currentHour > deadlineHour) {
          message = `⚠️ Deadline Passed: "${t.title}" (slated by ${t.deadline || "deadline"}). Let's re-plan this task.`;
          warningFound = true;
          break;
        } else if (deadlineHour - currentHour <= 1.0) {
          const minsLeft = Math.round((deadlineHour - currentHour) * 60);
          message = `⏰ Urgent: "${t.title}" is due in ${minsLeft} minutes (${t.deadline || "slated soon"}).`;
          warningFound = true;
          break;
        } else if (deadlineHour - currentHour <= 2.0) {
          message = `🔔 Upcoming: "${t.title}" deadline is approaching within 2 hours (${t.deadline}).`;
          warningFound = true;
          break;
        }
      }
    }

    // Check if total remaining time fits before a standard 10 PM end of day (22.0)
    if (!warningFound) {
      const totalMins = stored.tasks.reduce((sum, t) => sum + (t.estimated_minutes || 30), 0);
      const remainingDayMins = Math.max(0, (22.0 - currentHour) * 60);
      if (totalMins > remainingDayMins && remainingDayMins > 0) {
        message = `⏳ Time Squeeze: Remaining tasks need ${totalMins} minutes, but only ${Math.round(remainingDayMins)} minutes remain before 10 PM.`;
      }
    }

    addAgentLog(message);
    res.json({ message, log: loadData().agentLog });
  } catch (error) {
    console.error("Agent local check error:", error);
    res.status(500).json({ error: "Local agent check failed." });
  }
});

// === Endpoint to fetch the agent's activity log for the UI ===
app.get("/api/agent-log", (req, res) => {
  const stored = loadData();
  res.json({ log: stored.agentLog });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
