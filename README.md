# DailyMate

**AI-Powered Daily Task Companion**
*Vibe2Ship Hackathon — Coding Ninjas x Google for Developers*

---

## Problem Statement

**The Last-Minute Life Saver** — Help users who are overwhelmed, behind on tasks, or scrambling to meet deadlines get back on track quickly and calmly.

---

## Solution Overview

DailyMate is an AI-powered productivity companion that helps students, professionals, and entrepreneurs plan, prioritize, and complete their daily tasks before deadlines are missed. Instead of passive reminders, DailyMate actively analyzes tasks and energy level, builds a realistic time-blocked schedule, and autonomously re-plans the day as things get done.

---

## Key Features

- **Intelligent Task Prioritization** — Breaks down tasks into individual items and ranks them by urgency, deadlines, and current energy level, with a clear reason given for each ranking.

- **Autonomous Re-Planning (Agentic Behavior)** — When a task is marked complete, DailyMate automatically reassesses and re-prioritizes remaining tasks without requiring the user to start over.

- **Energy-Aware Scheduling** — Users select their energy state (High Energy, Balanced, Tired/Low, Stressed) via visual cards, or the AI infers it from their description. Task order adapts accordingly.

- **Visual Daily Timeline** — Generates a time-blocked schedule (start → end time per task) based on estimated duration, anchored to real local time.

- **Voice-Enabled Assistance** — Speak tasks instead of typing (browser speech recognition), and hear recommendations read aloud (text-to-speech) with automatic Hindi/English detection.

- **Multilingual Support** — Automatically detects and responds in the user's language or style: English, Hindi, Hinglish, Spanish, and more.

- **Calendar Export** — Generates a downloadable `.ics` file importable directly into Google Calendar or any calendar app.

- **Conversational, Encouraging Tone** — Short, warm, action-oriented responses designed to motivate the user toward their very next step.

- **Autonomous Agent Activity Monitoring** — A background agent runs periodically and independently, proactively checking task urgency even when the user hasn't acted. Its activity is shown in real time in a dedicated log panel above the task timeline.

- **Dark / Light Mode** — Full theme support for comfortable use at any time of day.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript |
| Backend | Express.js |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| Animations | Framer Motion |
| Voice | Web Speech API |
| Icons | Lucide React |

---

## Google Technologies

- **Google AI Studio** — Core development, iteration, and deployment environment.
- **Gemini API (gemini-2.5-flash)** — Powers task extraction, energy-based prioritization, duration estimation, multilingual generation, deadline reasoning, and autonomous re-planning via structured JSON output.
- **Google Cloud Run** — Hosts the deployed application via AI Studio's Publish feature.

---

## How It Works

1. User selects their **energy level** (or skips — AI infers it)
2. User types or **speaks** their tasks for the day
3. Gemini analyzes and returns a **prioritized, time-blocked plan**
4. User marks tasks done → DailyMate **auto-replans** the rest
5. Background agent **monitors urgency** independently and logs activity in real time
6. User can **export the schedule** to their calendar as `.ics`
