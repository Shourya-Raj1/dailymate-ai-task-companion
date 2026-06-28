# DailyMate — AI-Powered Daily Task Companion

DailyMate is an AI-powered productivity companion built for the **Vibe2Ship Hackathon** (Problem Statement: *The Last-Minute Life Saver*). It helps users plan, prioritize, and complete their daily tasks by understanding both their workload and their current energy level — going beyond passive reminders to actively guide users toward their next best action.

## ✨ Features

- **Intelligent Task Prioritization** — Breaks down tasks and ranks them by urgency, deadline, and energy level, with a clear reason for each ranking.
- **Autonomous Re-Planning** — Marking a task as done automatically triggers the AI to re-prioritize the remaining tasks.
- **Energy-Aware Scheduling** — Choose your energy state (High / Balanced / Tired / Stressed) and the AI adapts task order accordingly.
- **Visual Daily Timeline** — Auto-generates a time-blocked schedule based on estimated task durations, anchored to real IST time.
- **Voice-Enabled** — Speak your tasks (speech-to-text) and have the AI read its plan aloud (text-to-speech), with automatic Hindi/English accent detection.
- **Multilingual** — Detects and responds in whatever language or style the user uses (English, Hindi, Hinglish, Spanish, and more).
- **Calendar Export** — Download your AI-generated schedule as a `.ics` file for Google Calendar / Outlook.
- **Dark / Light Mode** — Full theme toggle support.

## 🛠️ Tech Stack

- **Frontend:** React + TypeScript, Vite, Tailwind CSS v4, Framer Motion
- **Backend:** Express.js (Node.js)
- **AI:** Google Gemini API (`gemini-2.5-flash`) via Google AI Studio, using structured JSON output (response schema)
- **Voice:** Web Speech API (SpeechRecognition + SpeechSynthesis)
- **Deployment:** Google Cloud Run (via Google AI Studio Publish)

## 🚀 Running Locally

\`\`\`bash
# Install dependencies
npm install

# Add your Gemini API key
cp .env.example .env
# then edit .env and add: GEMINI_API_KEY=your_key_here

# Run the development server
npm run dev
\`\`\`

The app will be available at the local URL shown in your terminal (frontend and backend are served together via Vite + Express).

## 📁 Project Structure

\`\`\`
src/
  App.tsx        — Main UI component, all frontend logic
  main.tsx       — React entry point
  index.css      — Global styles (Tailwind v4 + dark mode config)
server.ts        — Express backend, Gemini API integration
\`\`\`

## 🏆 Built For

**Vibe2Ship — Career Camp by Coding Ninjas x Google for Developers**
Problem Statement 1: *The Last-Minute Life Saver*
