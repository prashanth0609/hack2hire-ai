import { useState, useEffect, useRef } from "react";

const PHASES = { SETUP: "setup", INTERVIEW: "interview", REPORT: "report" };
const TIME_LIMIT = 90;
const EARLY_TERM_THRESHOLD = 30;
const EARLY_TERM_CONSECUTIVE = 2;

const MODEL = "claude-sonnet-4-20250514";
const API = "http://localhost:3001/api/messages";

async function callClaude(messages, system) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages }),
  });
  const d = await res.json();
  return d.content?.map(c => c.text || "").join("") || "";
}

function RadialScore({ score }) {
  const r = 54, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? "#1D9E75" : score >= 45 ? "#BA7517" : "#E24B4A";
  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 1s ease" }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="600" fill={color}>{score}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="#888">/ 100</text>
    </svg>
  );
}

function Timer({ seconds, total }) {
  const pct = seconds / total;
  const color = pct > 0.4 ? "#1D9E75" : pct > 0.2 ? "#BA7517" : "#E24B4A";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 120, height: 6, background: "#e5e7eb", borderRadius: 9 }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 9, transition: "width 1s linear, background 0.5s" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color, minWidth: 28 }}>{seconds}s</span>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState(PHASES.SETUP);
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [scores, setScores] = useState([]);
  const [difficulty, setDifficulty] = useState("Easy");
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [userAnswer, setUserAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [report, setReport] = useState(null);
  const [earlyTerm, setEarlyTerm] = useState(false);
  const [currentScore, setCurrentScore] = useState(null);
  const timerRef = useRef(null);
  const timeUsedRef = useRef(0);

  const startTimer = () => {
    timeUsedRef.current = 0;
    setTimeLeft(TIME_LIMIT);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleSubmitAnswer(true); return 0; }
        return t - 1;
      });
      timeUsedRef.current++;
    }, 1000);
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  const startInterview = async () => {
    if (!resume.trim() || !jd.trim()) return alert("Please enter both Resume and Job Description.");
    setLoading(true); setLoadMsg("Analyzing your resume and JD…");
    const sys = `You are an AI interview question generator. Given a candidate resume and job description, generate exactly 8 interview questions as a JSON array. Mix: 2 Easy technical/conceptual, 3 Medium technical/behavioral, 3 Hard scenario/system-design. Format: [{"q":"question text","type":"Technical|Behavioral|Scenario","difficulty":"Easy|Medium|Hard"}]. Return ONLY the JSON array, no markdown.`;
    const txt = await callClaude([{ role: "user", content: `Resume:\n${resume}\n\nJD:\n${jd}` }], sys);
    try {
      const clean = txt.replace(/```json|```/g, "").trim();
      const qs = JSON.parse(clean);
      setQuestions(qs); setQIndex(0); setPhase(PHASES.INTERVIEW);
      setTimeout(startTimer, 400);
    } catch { alert("Failed to parse questions. Try again."); }
    setLoading(false);
  };

  const handleSubmitAnswer = async (timedOut = false) => {
    clearInterval(timerRef.current);
    const ans = timedOut ? (userAnswer || "[No answer – timed out]") : userAnswer;
    const timeUsed = TIME_LIMIT - timeLeft;
    setLoading(true); setLoadMsg("Evaluating your answer…");

    const q = questions[qIndex];
    const sys = `You are a strict interview evaluator. Score the candidate's answer on 5 criteria (0-20 each): Accuracy, Clarity, Depth, Relevance, TimeEfficiency. TimeEfficiency: full marks if answered well under ${TIME_LIMIT}s, deduct proportionally for late/incomplete. Return ONLY JSON: {"accuracy":N,"clarity":N,"depth":N,"relevance":N,"timeEfficiency":N,"total":N,"feedback":"1-2 sentences","nextDifficulty":"Easy|Medium|Hard"}`;
    const prompt = `Question (${q.difficulty}): ${q.q}\nCandidate Answer: ${ans}\nTime used: ${timeUsed}s out of ${TIME_LIMIT}s${timedOut ? " (TIMED OUT)" : ""}`;
    const raw = await callClaude([{ role: "user", content: prompt }], sys);
    let sc;
    try { sc = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
    catch { sc = { accuracy: 10, clarity: 10, depth: 10, relevance: 10, timeEfficiency: 10, total: 50, feedback: "Could not evaluate.", nextDifficulty: difficulty }; }

    const newScores = [...scores, sc];
    const newAnswers = [...answers, { q: q.q, a: ans, timeUsed, timedOut, difficulty: q.difficulty, type: q.type }];
    setScores(newScores); setAnswers(newAnswers); setCurrentScore(sc); setLoading(false);

    const lowScores = newScores.slice(-EARLY_TERM_CONSECUTIVE);
    if (lowScores.length >= EARLY_TERM_CONSECUTIVE && lowScores.every(s => s.total < EARLY_TERM_THRESHOLD)) {
      setEarlyTerm(true);
      setTimeout(() => generateReport(newAnswers, newScores, true), 1500);
      return;
    }
    if (qIndex + 1 >= questions.length) {
      setTimeout(() => generateReport(newAnswers, newScores, false), 1500);
    }
  };

  const nextQuestion = () => {
    if (earlyTerm || qIndex + 1 >= questions.length) return;
    const sc = scores[scores.length - 1];
    setDifficulty(sc?.nextDifficulty || difficulty);
    setQIndex(i => i + 1); setUserAnswer(""); setCurrentScore(null);
    setTimeout(startTimer, 300);
  };

  const generateReport = async (ans, scs, early) => {
    setLoading(true); setLoadMsg("Generating your interview report…");
    setPhase(PHASES.REPORT);
    const overall = Math.round(scs.reduce((a, s) => a + s.total, 0) / scs.length);
    const sys = `You are an interview assessment expert. Given interview data, generate a JSON report: {"overallScore":N,"category":"Strong|Average|Needs Improvement","hiringReady":true/false,"strengths":["...","...","..."],"weaknesses":["...","...","..."],"skillBreakdown":{"Technical":N,"Communication":N,"ProblemSolving":N,"TimeManagement":N},"actionableFeedback":["...","...","..."]}. Return ONLY JSON.`;
    const prompt = `Resume:\n${resume}\nJD:\n${jd}\nAnswers+Scores:\n${JSON.stringify(ans.map((a, i) => ({ ...a, score: scs[i] })))}\nOverall avg: ${overall}\nEarly termination: ${early}`;
    const raw = await callClaude([{ role: "user", content: prompt }], sys);
    try {
      const rpt = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setReport({ ...rpt, overallScore: overall, earlyTerminated: early, totalQs: ans.length });
    } catch {
      setReport({ overallScore: overall, category: overall >= 70 ? "Strong" : overall >= 45 ? "Average" : "Needs Improvement", hiringReady: overall >= 65, strengths: ["Attempted questions"], weaknesses: ["Could not parse detailed feedback"], skillBreakdown: { Technical: overall, Communication: overall, ProblemSolving: overall, TimeManagement: overall }, actionableFeedback: ["Review your answers and practice more."], earlyTerminated: early, totalQs: ans.length });
    }
    setLoading(false);
  };

  const reset = () => {
    setPhase(PHASES.SETUP); setResume(""); setJd(""); setQuestions([]); setQIndex(0);
    setAnswers([]); setScores([]); setDifficulty("Easy"); setUserAnswer(""); setCurrentScore(null);
    setReport(null); setEarlyTerm(false); clearInterval(timerRef.current);
  };

  const diffColor = { Easy: "#1D9E75", Medium: "#BA7517", Hard: "#E24B4A" };
  const catColor = { Strong: "#1D9E75", Average: "#BA7517", "Needs Improvement": "#E24B4A" };

  if (loading) return (
    <div style={{ minHeight: 320, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "3rem 1rem" }}>
      <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTop: "3px solid #534AB7", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <p style={{ color: "#888", fontSize: 15 }}>{loadMsg}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (phase === PHASES.SETUP) return (
    <div style={{ padding: "1.5rem 1rem", maxWidth: 700, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 4px" }}>Hack2Hire</h2>
        <p style={{ fontSize: 14, color: "#888", margin: 0 }}>AI-powered mock interview — adaptive questions, real-time scoring, detailed report</p>
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Your Resume <span style={{ color: "#888", fontWeight: 400 }}>(paste plain text)</span></label>
          <textarea value={resume} onChange={e => setResume(e.target.value)} placeholder="Paste your resume text here — skills, experience, projects, education…" rows={8} style={{ width: "100%", fontSize: 13, fontFamily: "monospace", padding: "10px 12px", borderRadius: 8, border: "0.5px solid #d1d5db", resize: "vertical", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Job Description <span style={{ color: "#888", fontWeight: 400 }}>(paste full JD)</span></label>
          <textarea value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the job description here — role, responsibilities, required skills…" rows={6} style={{ width: "100%", fontSize: 13, fontFamily: "monospace", padding: "10px 12px", borderRadius: 8, border: "0.5px solid #d1d5db", resize: "vertical", boxSizing: "border-box" }} />
        </div>
        <div style={{ background: "#f9f8ff", border: "0.5px solid #AFA9EC", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#534AB7" }}>
          ⏱ 90s per question · 8 adaptive questions · Early exit if score drops below 30/100 · Full report at end
        </div>
        <button onClick={startInterview} style={{ background: "#534AB7", color: "#fff", border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 15, fontWeight: 500, cursor: "pointer", alignSelf: "flex-start" }}>
          Start Interview →
        </button>
      </div>
    </div>
  );

  if (phase === PHASES.INTERVIEW) {
    const q = questions[qIndex];
    if (!q) return null;
    return (
      <div style={{ padding: "1.5rem 1rem", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#888" }}>Q {qIndex + 1} / {questions.length}</span>
            <span style={{ fontSize: 12, fontWeight: 500, padding: "3px 10px", borderRadius: 20, background: diffColor[q.difficulty] + "22", color: diffColor[q.difficulty] }}>{q.difficulty}</span>
            <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: "#f3f4f6", color: "#555" }}>{q.type}</span>
          </div>
          {!currentScore && <Timer seconds={timeLeft} total={TIME_LIMIT} />}
        </div>

        <div style={{ background: "#f9f8ff", border: "0.5px solid #AFA9EC", borderRadius: 10, padding: "16px 18px", marginBottom: 18, fontSize: 15, lineHeight: 1.6, color: "#1a1a2e" }}>
          {q.q}
        </div>

        {!currentScore ? (
          <>
            <textarea value={userAnswer} onChange={e => setUserAnswer(e.target.value)} placeholder="Type your answer here…" rows={5} style={{ width: "100%", fontSize: 14, padding: "10px 12px", borderRadius: 8, border: "0.5px solid #d1d5db", resize: "vertical", boxSizing: "border-box", marginBottom: 12 }} />
            <button onClick={() => handleSubmitAnswer(false)} style={{ background: "#534AB7", color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              Submit Answer
            </button>
          </>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
              {["Accuracy", "Clarity", "Depth", "Relevance", "Time"].map((k, i) => {
                const val = [currentScore.accuracy, currentScore.clarity, currentScore.depth, currentScore.relevance, currentScore.timeEfficiency][i];
                return (
                  <div key={k} style={{ background: "#f9f9f9", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 500, color: val >= 14 ? "#1D9E75" : val >= 8 ? "#BA7517" : "#E24B4A" }}>{val}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{k}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ background: "#f0fdf4", border: "0.5px solid #9FE1CB", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#0F6E56", marginBottom: 14 }}>
              <strong>Score: {currentScore.total}/100</strong> — {currentScore.feedback}
            </div>
            {earlyTerm ? (
              <div style={{ background: "#fff0f0", border: "0.5px solid #F09595", borderRadius: 8, padding: "12px 14px", fontSize: 14, color: "#A32D2D" }}>
                Interview ended early due to low consecutive scores. Generating report…
              </div>
            ) : qIndex + 1 < questions.length ? (
              <button onClick={nextQuestion} style={{ background: "#1D9E75", color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                Next Question →
              </button>
            ) : (
              <div style={{ fontSize: 14, color: "#888" }}>Generating your final report…</div>
            )}
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 6 }}>
          {questions.map((_, i) => (
            <div key={i} style={{ width: 28, height: 6, borderRadius: 3, background: i < scores.length ? (scores[i]?.total >= 65 ? "#1D9E75" : scores[i]?.total >= 40 ? "#BA7517" : "#E24B4A") : i === qIndex ? "#534AB7" : "#e5e7eb" }} />
          ))}
        </div>
      </div>
    );
  }

  if (phase === PHASES.REPORT && report) {
    const cat = report.category || "Average";
    return (
      <div style={{ padding: "1.5rem 1rem", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>Interview Report</h2>
          <button onClick={reset} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 6, border: "0.5px solid #d1d5db", background: "transparent", cursor: "pointer" }}>New Interview</button>
        </div>

        {report.earlyTerminated && (
          <div style={{ background: "#fff0f0", border: "0.5px solid #F09595", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D", marginBottom: 16 }}>
            Interview was terminated early after {report.totalQs} questions due to consistently low performance.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "center", background: "#f9f8ff", border: "0.5px solid #AFA9EC", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
          <RadialScore score={report.overallScore} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, color: catColor[cat] || "#333", marginBottom: 4 }}>{cat}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, padding: "4px 12px", borderRadius: 20, background: report.hiringReady ? "#E1F5EE" : "#FCEBEB", color: report.hiringReady ? "#0F6E56" : "#A32D2D", fontWeight: 500 }}>
                {report.hiringReady ? "✓ Hire Ready" : "✗ Not Ready Yet"}
              </span>
              <span style={{ fontSize: 13, color: "#888" }}>{report.totalQs} questions answered</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Readiness score out of 100</p>
          </div>
        </div>

        {report.skillBreakdown && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Skill breakdown</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {Object.entries(report.skillBreakdown).map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "140px 1fr 36px", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13 }}>{k}</span>
                  <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3 }}>
                    <div style={{ width: `${v}%`, height: "100%", borderRadius: 3, background: v >= 65 ? "#1D9E75" : v >= 40 ? "#BA7517" : "#E24B4A", transition: "width 1s ease" }} />
                  </div>
                  <span style={{ fontSize: 13, color: "#555" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#f0fdf4", border: "0.5px solid #9FE1CB", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#0F6E56", marginBottom: 8 }}>Strengths</div>
            {(report.strengths || []).map((s, i) => <div key={i} style={{ fontSize: 13, color: "#085041", marginBottom: 4 }}>✓ {s}</div>)}
          </div>
          <div style={{ background: "#fff9f0", border: "0.5px solid #FAC775", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#854F0B", marginBottom: 8 }}>Areas to improve</div>
            {(report.weaknesses || []).map((w, i) => <div key={i} style={{ fontSize: 13, color: "#633806", marginBottom: 4 }}>↗ {w}</div>)}
          </div>
        </div>

        {report.actionableFeedback && (
          <div style={{ border: "0.5px solid #e5e7eb", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Actionable feedback</div>
            {report.actionableFeedback.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#534AB7", fontWeight: 500 }}>{i + 1}.</span>
                <span style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>{f}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button onClick={reset} style={{ background: "#534AB7", color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            Practice Again
          </button>
        </div>
      </div>
    );
  }

  return null;
}