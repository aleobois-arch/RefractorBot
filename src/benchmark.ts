import { callLLM } from './llm';
import { extractJson } from './agents';
import { runRefactorBot, AgentLog, LogSink, newUsageTotals, trackUsage, UsageTotals } from './orchestrator';

/**
 * Track 3 requires "a measurable efficiency gain over single-agent baselines".
 * This module provides exactly that measurement:
 *
 *   1. BASELINE — one single-shot Qwen call that parses, designs, writes and
 *      self-checks the refactor in a single prompt (what a naive integration
 *      would do).
 *   2. SOCIETY — the full multi-agent pipeline (parser → architect → developer
 *      → parallel QA panel → arbitration loop).
 *   3. JUDGE — an independent Qwen judge scores BOTH outputs blind (it never
 *      knows which candidate came from which pipeline) against a fixed rubric.
 *
 * The endpoint reports quality scores, token spend and wall-clock time for
 * both, plus the deltas.
 */

export interface RubricScore {
  security: number;
  correctness: number;
  architecture: number;
  maintainability: number;
  total: number;
  rationale: string;
}

export interface CandidateReport {
  pipeline: 'single-agent-baseline' | 'agent-society';
  code: string;
  score: RubricScore;
  usage: UsageTotals;
  durationMs: number;
  approvedByPanel?: boolean;
}

export interface BenchmarkReport {
  baseline: CandidateReport;
  society: CandidateReport;
  delta: {
    qualityGain: number;
    qualityGainPercent: number;
    extraTokens: number;
    extraSeconds: number;
  };
  logs: AgentLog[];
}

async function runBaseline(
  legacyCode: string,
  targetFramework: string,
  recordLog: (agent: string, action: string) => void
): Promise<{ code: string; usage: UsageTotals; durationMs: number }> {
  const startTime = Date.now();
  const usage = newUsageTotals();
  recordLog('Baseline (single agent)', 'Refactoring in ONE single-shot prompt (no society, no review loop)...');
  const system =
    'You are a Senior Developer. In a single pass: parse the legacy code, design the target architecture, ' +
    `write production-grade ${targetFramework} code, and double-check it yourself. Output ONLY the code files.`;
  const result = await callLLM('baseline', system, 'Legacy code:\n\n' + legacyCode + '\n\nTarget framework: ' + targetFramework);
  trackUsage(usage, 'Baseline', result.usage);
  recordLog('Baseline (single agent)', 'Single-shot refactor complete.');
  return { code: result.content, usage, durationMs: Date.now() - startTime };
}

const JUDGE_SYSTEM =
  'You are an impartial code-quality judge. You do NOT know how the code was produced. ' +
  'Score the candidate against this rubric, each dimension 0-10: ' +
  'security (input validation, injection surfaces, error leakage), ' +
  'correctness (business logic preserved, edge cases), ' +
  'architecture (typed contracts, framework idioms, modularity), ' +
  'maintainability (readability, error handling, documentation). ' +
  'Return ONLY JSON: { "security": n, "correctness": n, "architecture": n, "maintainability": n, "total": n, "rationale": string } ' +
  'where total is the average of the four dimensions, one decimal.';

async function judgeCandidate(
  code: string,
  targetFramework: string,
  usage: UsageTotals,
  recordLog: (agent: string, action: string) => void,
  label: string
): Promise<RubricScore> {
  recordLog('Judge', `Scoring ${label} blind against the 4-dimension rubric...`);
  const result = await callLLM('judge', JUDGE_SYSTEM, `Target framework: ${targetFramework}\n\nCandidate code:\n\n${code}`);
  trackUsage(usage, 'Judge', result.usage);
  const fallback: RubricScore = { security: 0, correctness: 0, architecture: 0, maintainability: 0, total: 0, rationale: 'Judge output unparseable.' };
  const parsed = extractJson<Partial<RubricScore>>(result.content, fallback);
  const clamp = (n: unknown) => (typeof n === 'number' && n >= 0 && n <= 10 ? Math.round(n * 10) / 10 : 0);
  const score: RubricScore = {
    security: clamp(parsed.security),
    correctness: clamp(parsed.correctness),
    architecture: clamp(parsed.architecture),
    maintainability: clamp(parsed.maintainability),
    total: 0,
    rationale: parsed.rationale || 'n/a',
  };
  score.total = clamp(parsed.total) || Math.round(((score.security + score.correctness + score.architecture + score.maintainability) / 4) * 10) / 10;
  recordLog('Judge', `${label} score: ${score.total}/10 — ${score.rationale}`);
  return score;
}

export async function runBenchmark(legacyCode: string, targetFramework: string, onLog?: LogSink): Promise<BenchmarkReport> {
  const logs: AgentLog[] = [];
  const recordLog = (agent: string, action: string) => {
    const entry = { agent, action, timestamp: new Date().toLocaleTimeString() };
    logs.push(entry);
    console.log(`[benchmark][${agent}]: ${action}`);
    onLog?.(entry);
  };

  recordLog('System', '🏁 Benchmark: single-agent baseline VS agent society on identical input.');

  // Candidate A — single-agent baseline
  const baselineRun = await runBaseline(legacyCode, targetFramework, recordLog);

  // Candidate B — the full agent society (its own logs are forwarded live)
  recordLog('System', 'Now running the full agent society on the same input...');
  const societyRun = await runRefactorBot(legacyCode, targetFramework, (entry) => {
    logs.push(entry);
    onLog?.(entry);
  });

  // Blind judging (the judge only ever sees "candidate code")
  const judgeUsage = newUsageTotals();
  const baselineScore = await judgeCandidate(baselineRun.code, targetFramework, judgeUsage, recordLog, 'candidate #1');
  const societyScore = await judgeCandidate(societyRun.generatedCode, targetFramework, judgeUsage, recordLog, 'candidate #2');

  const baseline: CandidateReport = {
    pipeline: 'single-agent-baseline',
    code: baselineRun.code,
    score: baselineScore,
    usage: baselineRun.usage,
    durationMs: baselineRun.durationMs,
  };
  const society: CandidateReport = {
    pipeline: 'agent-society',
    code: societyRun.generatedCode,
    score: societyScore,
    usage: societyRun.usage,
    durationMs: societyRun.durationMs,
    approvedByPanel: societyRun.approved,
  };

  const qualityGain = Math.round((societyScore.total - baselineScore.total) * 10) / 10;
  const report: BenchmarkReport = {
    baseline,
    society,
    delta: {
      qualityGain,
      qualityGainPercent: baselineScore.total > 0 ? Math.round((qualityGain / baselineScore.total) * 1000) / 10 : 0,
      extraTokens:
        society.usage.inputTokens + society.usage.outputTokens - (baseline.usage.inputTokens + baseline.usage.outputTokens),
      extraSeconds: Math.round((society.durationMs - baseline.durationMs) / 100) / 10,
    },
    logs,
  };

  recordLog(
    'System',
    `🏆 Verdict: society ${societyScore.total}/10 vs baseline ${baselineScore.total}/10 ` +
      `(+${report.delta.qualityGain} points, +${report.delta.qualityGainPercent}%) ` +
      `for +${report.delta.extraTokens} tokens and +${report.delta.extraSeconds}s.`
  );

  return report;
}
