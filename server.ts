/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini client setup with custom User-Agent for telemetry
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

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
6. Write one short, warm "next_action" message summarizing what to do right now (in the user's language, 2-3 sentences, conversational, no markdown — this gets read aloud).`;

  // Intelligent Local Fallback Generator for offline/quota exceeded states
  function getFallbackDailyPlan(userInput: string, preferredEnergyLevel?: string) {
    // 1. Detect energy level
    let energy_level = preferredEnergyLevel || "Balanced";
    if (!preferredEnergyLevel) {
      if (userInput.includes("High Energy")) {
        energy_level = "High Energy";
      } else if (userInput.includes("Tired / Low") || userInput.includes("tired") || userInput.toLowerCase().includes("tired")) {
        energy_level = "Tired / Low";
      } else if (userInput.includes("Stressed") || userInput.toLowerCase().includes("stress")) {
        energy_level = "Stressed";
      } else if (userInput.includes("Balanced") || userInput.toLowerCase().includes("balance")) {
        energy_level = "Balanced";
      }
    }

    // Clean the prefix from the user input if present
    let cleanInput = userInput;
    const prefixMatch = userInput.match(/^My current energy level is: [^.]+\.\s*/);
    if (prefixMatch) {
      cleanInput = userInput.substring(prefixMatch[0].length);
    }

    // 2. Extract tasks (split by typical separators)
    const splitters = [/\n+/, /;\s*/, /,\s*and\s+/, /\s+and\s+/, /\s+then\s+/, /\s+after that\s+/];
    let rawTasks: string[] = [cleanInput];

    for (const splitter of splitters) {
      const temp: string[] = [];
      for (const t of rawTasks) {
        const parts = t.split(splitter);
        temp.push(...parts);
      }
      rawTasks = temp;
    }

    // Filter, clean, and deduplicate
    const tasksList: string[] = [];
    const seen = new Set<string>();

    for (let t of rawTasks) {
      t = t.trim()
        .replace(/^[-*•\d.]+\s*/, "") // remove bullet/numbers
        .replace(/^(I need to|I have to|to|please|want to|wanna)\s+/i, "") // remove task phrase prefixes
        .trim();
      
      if (t.length > 2) {
        // Capitalize first letter
        t = t.charAt(0).toUpperCase() + t.slice(1);
        const lower = t.toLowerCase();
        if (!seen.has(lower) && lower.length > 3) {
          seen.add(lower);
          tasksList.push(t);
        }
      }
    }

    // If no clear tasks were extracted, use the cleanInput itself as a task
    if (tasksList.length === 0 && cleanInput.trim().length > 0) {
      tasksList.push(cleanInput.trim());
    }

    // If still empty, add default tasks
    if (tasksList.length === 0) {
      tasksList.push("Plan my day", "Take a short break");
    }

    // 3. Construct structured task items
    const tasks = tasksList.map((title, i) => {
      let estimated_minutes = 30; // default
      const hourMatch = title.match(/(\d+)\s*(hours|hour|hr|hrs)/i);
      const minMatch = title.match(/(\d+)\s*(minutes|minute|min|mins)/i);
      if (hourMatch) {
        estimated_minutes = parseInt(hourMatch[1]) * 60;
      } else if (minMatch) {
        estimated_minutes = parseInt(minMatch[1]);
      } else {
        // Keyword-based duration guesser
        const titleLower = title.toLowerCase();
        if (titleLower.includes("project") || titleLower.includes("study") || titleLower.includes("work") || titleLower.includes("exam") || titleLower.includes("assignment")) {
          estimated_minutes = 60;
        } else if (titleLower.includes("exercise") || titleLower.includes("gym") || titleLower.includes("workout")) {
          estimated_minutes = 45;
        } else if (titleLower.includes("read") || titleLower.includes("book")) {
          estimated_minutes = 30;
        } else if (titleLower.includes("mail") || titleLower.includes("call") || titleLower.includes("lunch") || titleLower.includes("eat")) {
          estimated_minutes = 20;
        }
      }

      // Try to extract deadline if present
      let deadline = "";
      const byMatch = title.match(/(by|before|at)\s+([\d:]+\s*(am|pm)?|\w+\s+evening|\w+\s+morning|tonight|today)/i);
      if (byMatch) {
        deadline = byMatch[2];
      }

      let priority_rank = i + 1;

      let reason = "Let's get this done during your peak hours.";
      if (energy_level === "Tired / Low") {
        reason = "Easy quick win to keep your momentum going without draining you.";
      } else if (energy_level === "Stressed") {
        reason = "Taking it step-by-step to keep stress levels low and steady.";
      } else if (energy_level === "Balanced") {
        reason = "Optimal slot for steady progress and balanced productivity.";
      }

      return {
        title,
        deadline,
        priority_rank,
        reason,
        estimated_minutes
      };
    });

    // Sort tasks: if low energy or tired, put smaller tasks first
    if (energy_level === "Tired / Low" || energy_level === "Stressed") {
      tasks.sort((a, b) => a.estimated_minutes - b.estimated_minutes);
    } else {
      tasks.sort((a, b) => b.estimated_minutes - a.estimated_minutes);
    }

    // Re-index priority rank after sorting
    tasks.forEach((task, index) => {
      task.priority_rank = index + 1;
    });

    // 4. Generate next action summary sentence
    let next_action = "Here is your personalized schedule. Take it one task at a time, you've got this!";
    if (energy_level === "Tired / Low") {
      next_action = "Since energy is low, we started with easier tasks to build gentle momentum. Rest whenever you need to!";
    } else if (energy_level === "Stressed") {
      next_action = "Let's focus on just one thing right now. Take a deep breath and start with the first item on your timeline.";
    } else if (energy_level === "High Energy") {
      next_action = "Your energy is high right now! We've lined up your most critical tasks first. Let's crush them!";
    }

    return {
      energy_level,
      next_action,
      tasks
    };
  }

  // Retries a Gemini call with exponential backoff if rate-limited
  async function generateContentWithRetry(prompt: string, maxRetries = 3) {
    let lastError: unknown;
    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempting Gemini generation using model: ${model} (attempt ${attempt}/${maxRetries})...`);
          const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              responseSchema: {
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
              },
            },
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
      console.warn(`Model ${model} failed after all retries. Trying next model if available...`);
    }

    throw lastError;
  }

  // API endpoint
  app.post("/api/dailymate", async (req, res) => {
    try {
      const { userInput, energyLevel } = req.body;

      if (!userInput || !userInput.trim()) {
        return res.status(400).json({ error: "Input is empty" });
      }

      const response = await generateContentWithRetry(userInput);
      const data = JSON.parse(response.text);

      // Apply preferred energy override if provided
      if (energyLevel) {
        const energyMap: Record<string, string> = {
          high: "High Energy",
          balanced: "Balanced",
          tired: "Tired / Low",
          stressed: "Stressed"
        };
        const preferredEnergy = energyMap[energyLevel];
        if (preferredEnergy) {
          data.energy_level = preferredEnergy;
        }
      }

      res.json(data);
    } catch (error) {
      console.warn("Gemini API error or exhaustion, using high-performance local fallback generator:", error);
      
      try {
        const { userInput, energyLevel } = req.body;
        const energyMap: Record<string, string> = {
          high: "High Energy",
          balanced: "Balanced",
          tired: "Tired / Low",
          stressed: "Stressed"
        };
        const preferredEnergy = energyLevel ? energyMap[energyLevel] : undefined;
        const fallbackData = getFallbackDailyPlan(userInput || "", preferredEnergy);
        res.json(fallbackData);
      } catch (fallbackErr) {
        console.error("Local fallback also failed:", fallbackErr);
        res.status(500).json({ error: "Something went wrong while compiling your plan." });
      }
    }
  });

  // Vite development or production serving
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
