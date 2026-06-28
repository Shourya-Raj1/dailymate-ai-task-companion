/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useRef, useEffect } from "react";
import { Sparkles, Calendar, Heart, Send, Loader2, Circle, Flame, Zap, Coffee, AlertCircle, Mic, MicOff, Moon, Sun, Bot } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Task {
  title: string;
  deadline: string;
  priority_rank: number;
  reason: string;
  estimated_minutes: number;
  done?: boolean;
  age?: number;
}

interface AiResult {
  energy_level: string;
  next_action: string;
  tasks: Task[];
}

interface AgentLogEntry {
  timestamp: string;
  message: string;
}

const ENERGY_OPTIONS = [
  { id: "high", label: "High Energy", sublabel: "Hardest first", icon: Flame, color: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-400" },
  { id: "balanced", label: "Balanced", sublabel: "Normal pace", icon: Zap, color: "text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400" },
  { id: "tired", label: "Tired / Low", sublabel: "Quick wins first", icon: Coffee, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-400" },
  { id: "stressed", label: "Stressed", sublabel: "One thing at a time", icon: AlertCircle, color: "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400" },
];

const containsHindiScript = (text: string) => /[\u0900-\u097F]/.test(text);

const HINGLISH_MARKERS = [
  "hai", "ka", "ki", "ko", "ke", "mein", "se", "aur", "tum", "tumhe", "mujhe",
  "karna", "kar", "raha", "rahi", "rahe", "abhi", "aaj", "kal", "kyu", "kyunki",
  "thoda", "bahut", "achha", "theek", "nahi", "haan", "chal", "chalo",
];

const looksLikeHinglish = (text: string) => {
  const lower = text.toLowerCase();
  const matchCount = HINGLISH_MARKERS.filter((word) =>
    new RegExp(`\\b${word}\\b`).test(lower)
  ).length;
  return matchCount >= 2;
};

export default function App() {
  const [userInput, setUserInput] = useState("");
  const [selectedEnergy, setSelectedEnergy] = useState<string | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);

  const taskAgeRef = useRef<Record<string, number>>({});
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    window.speechSynthesis.getVoices();
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Autonomous background agent check — runs periodically without user action,
  // proactively monitoring tasks for urgency even when the user hasn't asked.
  useEffect(() => {
    const runAgentCheck = async () => {
      try {
        const res = await fetch("/api/agent-check");
        if (res.ok) {
          const data = await res.json();
          if (data.log) setAgentLog(data.log);
        }
      } catch (e) {
        console.error("Agent check failed:", e);
      }
    };

    const initialTimeout = setTimeout(runAgentCheck, 5000);
    const interval = setInterval(runAgentCheck, 180000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  const calculateTimeline = (tasks: Task[]) => {
    const now = new Date();
    const utcMillis = now.getTime() + now.getTimezoneOffset() * 60000;
    let currentTime = new Date(utcMillis + 5.5 * 60 * 60000);

    return tasks.map((task) => {
      const start = new Date(currentTime);
      const end = new Date(currentTime.getTime() + task.estimated_minutes * 60000);
      currentTime = end;
      return {
        ...task,
        startLabel: start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        endLabel: end.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      };
    });
  };

  const bumpTaskAges = (tasks: Task[]) => {
    tasks.forEach((t) => {
      taskAgeRef.current[t.title] = (taskAgeRef.current[t.title] || 0) + 1;
    });
  };

  const fetchPlan = async (inputText: string) => {
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/dailymate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: inputText }),
      });

      if (!res.ok) throw new Error("Server error");

      const data: AiResult = await res.json();
      data.tasks.sort((a, b) => a.priority_rank - b.priority_rank);

      data.tasks = data.tasks.map((t) => ({ ...t, age: taskAgeRef.current[t.title] || 0 }));

      setResult(data);
      bumpTaskAges(data.tasks);
    } catch (err) {
      setError("Something went wrong. Please try again.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    const energyLabel = ENERGY_OPTIONS.find((opt) => opt.id === selectedEnergy)?.label;
    const finalInput = energyLabel
      ? `[USER-SELECTED ENERGY LEVEL: ${energyLabel}. Use this exact energy level for prioritization, even if my message below sounds different.] ${userInput}`
      : userInput;

    fetchPlan(finalInput);
  };

  const markTaskDone = (index: number) => {
    if (!result) return;

    const completedTask = result.tasks[index];
    delete taskAgeRef.current[completedTask.title];

    const remainingTasks = result.tasks.filter((_, i) => i !== index);

    if (remainingTasks.length === 0) {
      setResult({ ...result, tasks: [], next_action: "All tasks done! Today was well spent. 🎉" });
      return;
    }

    const ageInfo = remainingTasks
      .map((t) => {
        const age = taskAgeRef.current[t.title] || 0;
        return age > 0 ? `"${t.title}" has been carried over ${age} time(s) without completion.` : null;
      })
      .filter(Boolean)
      .join(" ");

    const remainingDescription = remainingTasks
      .map((t) => `${t.title}${t.deadline ? ` (deadline: ${t.deadline})` : ""}`)
      .join(", ");

    const followUpInput = `I just completed "${completedTask.title}". My remaining tasks are: ${remainingDescription}. My energy level is still ${result.energy_level}.${ageInfo ? ` [TASK AGE INFO] ${ageInfo}` : ""} Please re-prioritize.`;

    fetchPlan(followUpInput);
  };

  const speakAloud = (text: string) => {
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    const shouldUseHindiVoice = containsHindiScript(text) || looksLikeHinglish(text);

    if (shouldUseHindiVoice) {
      const hindiVoice = voices.find((v) => v.lang === "hi-IN");
      if (hindiVoice) {
        utterance.voice = hindiVoice;
      }
      utterance.lang = "hi-IN";
    } else {
      utterance.lang = "en-IN";
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setUserInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };

    recognition.onerror = () => {
      setIsListening(false);
      setError("Couldn't hear that clearly. Please try again.");
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopVoiceInput = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const exportToCalendar = (tasks: Task[]) => {
    const timeline = calculateTimeline(tasks);

    const formatICSDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    let icsContent = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DailyMate//Task Planner//EN"].join("\r\n");

    let cursor = new Date();
    timeline.forEach((task, index) => {
      const start = new Date(cursor);
      const end = new Date(cursor.getTime() + task.estimated_minutes * 60000);
      cursor = end;

      icsContent += "\r\n" + [
        "BEGIN:VEVENT",
        `UID:dailymate-${Date.now()}-${index}@dailymate.app`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART:${formatICSDate(start)}`,
        `DTEND:${formatICSDate(end)}`,
        `SUMMARY:${task.title}`,
        `DESCRIPTION:${task.reason}`,
        "END:VEVENT",
      ].join("\r\n");
    });

    icsContent += "\r\nEND:VCALENDAR";

    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dailymate-schedule.ics";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div id="app-container" className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans flex flex-col justify-between transition-colors duration-300">
      <header id="app-header" className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">DailyMate</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Tasks & Mood Companion</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              Gemini Connected
            </div>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setIsDarkMode((prev) => !prev)}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-amber-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              aria-label="Toggle dark mode"
            >
              <AnimatePresence mode="wait" initial={false}>
                {isDarkMode ? (
                  <motion.div key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <Sun className="w-4 h-4" />
                  </motion.div>
                ) : (
                  <motion.div key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <Moon className="w-4 h-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-grow max-w-3xl w-full mx-auto px-4 py-8 md:py-12 flex flex-col gap-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-indigo-500 to-violet-600 dark:from-indigo-600 dark:to-violet-700 rounded-2xl p-6 md:p-8 text-white shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-indigo-200" />
            <span className="text-xs font-semibold tracking-wider uppercase text-indigo-100">Welcome to DailyMate</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">How is your day shaping up?</h2>
          <p className="text-indigo-100 text-sm max-w-xl leading-relaxed">
            Pick your energy level, type or speak your tasks, and DailyMate will prioritize them,
            build a timeline, and re-plan automatically as you complete things.
          </p>
        </motion.div>

        {/* Autonomous Agent Activity Log — shown globally, not just inside result */}
        {agentLog.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 flex flex-col gap-3"
          >
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                Autonomous Agent Activity
              </span>
            </div>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
              {agentLog.slice(0, 5).map((entry, i) => (
                <div key={`log-${i}-${entry.timestamp}`} className="text-xs text-slate-700 dark:text-slate-300 flex gap-2">
                  <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-xs"
        >
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">How's your energy right now?</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ENERGY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = selectedEnergy === opt.id;
              return (
                <motion.button
                  key={opt.id}
                  type="button"
                  whileHover={{ scale: 1.03, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedEnergy(opt.id)}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border-2 text-left transition-all duration-200 ${
                    isSelected
                      ? `${opt.color} border-current shadow-sm`
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                  <span className="text-[10px] opacity-70 leading-tight">{opt.sublabel}</span>
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-xs"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="daily-input" className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-500" />
                  Your Tasks & Feelings
                </label>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={isListening ? stopVoiceInput : startVoiceInput}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isListening
                      ? "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 animate-pulse"
                      : "bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600"
                  }`}
                >
                  {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {isListening ? "Listening..." : "Speak"}
                </motion.button>
              </div>

              <textarea
                id="daily-input"
                rows={5}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-4 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm resize-none"
                placeholder="e.g., I have to finish my history project and study for math today! Or tap Speak and just talk."
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 mt-2">
              <span className="text-xs text-slate-400 dark:text-slate-500">{userInput.length} characters</span>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={!userInput.trim() || isLoading}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-sm ${
                  userInput.trim() && !isLoading
                    ? "bg-slate-900 dark:bg-indigo-600 text-white hover:bg-slate-800 dark:hover:bg-indigo-500 cursor-pointer"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                }`}
              >
                {isLoading ? "Thinking..." : "Submit"}
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </motion.button>
            </div>
          </form>
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-red-500 dark:text-red-400 text-center">
              {error}
            </motion.p>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800 rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                    Next Action • Energy: {result.energy_level}
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => speakAloud(result.next_action)}
                    className="text-xs bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-slate-700 transition-colors font-medium"
                  >
                    🔊 Listen Aloud
                  </motion.button>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{result.next_action}</p>
              </div>

              {result.tasks.length > 0 && (
                <div className="flex flex-col gap-1">
                  {/* ✅ Autonomous Agent Activity Log — now placed above timeline */}
                  {agentLog.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 flex flex-col gap-3 mb-3"
                    >
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                          Autonomous Agent Activity
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                        {agentLog.slice(0, 5).map((entry, i) => (
                          <div key={`log-inline-${i}-${entry.timestamp}`} className="text-xs text-slate-700 dark:text-slate-300 flex gap-2">
                            <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">
                              {new Date(entry.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span>{entry.message}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  <div className="flex items-center justify-between px-1 mb-1">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Today's Timeline</h3>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => exportToCalendar(result.tasks)}
                      className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium flex items-center gap-1.5"
                    >
                      📅 Export to Calendar
                    </motion.button>
                  </div>
                  {calculateTimeline(result.tasks).map((task, index) => (
                    <motion.div
                      key={`task-${index}-${task.title}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      whileHover={{ scale: 1.01 }}
                      transition={{ delay: index * 0.05 }}
                      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-start gap-4 transition-shadow hover:shadow-md"
                    >
                      <div className="flex flex-col items-center flex-shrink-0 w-16 pt-0.5">
                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{task.startLabel}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{task.endLabel}</span>
                      </div>

                      <motion.button whileTap={{ scale: 0.9 }} onClick={() => markTaskDone(index)} className="mt-0.5 flex-shrink-0">
                        <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors" />
                      </motion.button>

                      <div className="flex-grow">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-indigo-500 dark:text-indigo-400">#{task.priority_rank}</span>
                          <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{task.title}</h4>
                          {task.age && task.age > 0 ? (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                              carried over {task.age}x
                            </span>
                          ) : null}
                          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">{task.estimated_minutes} min</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{task.reason}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-6 mt-12 text-center text-xs text-slate-400 dark:text-slate-500">
        <div className="max-w-3xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>&copy; 2026 DailyMate. Built with care.</p>
          <p className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
            Live Mode
          </p>
        </div>
      </footer>
    </div>
  );
}