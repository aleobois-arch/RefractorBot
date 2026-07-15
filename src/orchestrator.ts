import * as fs from 'fs';
import * as path from 'path';
import {
  parserAgent,
  architectAgent,
  devAgent,
  securityQaAgent,
  performanceQaAgent,
  correctnessQaAgent,
  reviewerAgent,
  QaVerdict,
} from './agents';
import { LlmUsage } from './llm';

// On Alibaba Function Compute the code directory is read-only; only /tmp is
// writable. Fall back to /tmp there, and never let a disk error kill the run —
// the generated code is returned in the HTTP response either way.
const OUTPUT_DIR = process.env.FC_FUNC_CODE_PATH
  ? path.join('/tmp', 'refactorbot-output')
  : path.join(__dirname, '../output');

function saveOutput(fileName: string, content: string, recordLog: (a: string, b: string) => void) {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), content);
  } catch (err: any) {
    recordLog('System Warning', `Could not write ${fileName} to disk: ${err.message}`);
  }
}

export interface AgentLog {
  agent: string;
  action: string;
  timestamp: string;
}

/** Optional live sink so SSE clients can watch the negotiation as it happens. */
export type LogSink = (entry: AgentLog) => void;

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
}

export function newUsageTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, byAgent: {} };
}

export function trackUsage(totals: UsageTotals, agent: string, usage: LlmUsage): void {
  totals.calls += 1;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  const bucket = (totals.byAgent[agent] ||= { calls: 0, inputTokens: 0, outputTokens: 0 });
  bucket.calls += 1;
  bucket.inputTokens += usage.inputTokens;
  bucket.outputTokens += usage.outputTokens;
}

export interface RefactorResult {
  generatedCode: string;
  approved: boolean;
  attempts: number;
  logs: AgentLog[];
  usage: UsageTotals;
  finalVerdicts: QaVerdict[];
  durationMs: number;
}

export async function runRefactorBot(
  legacyCode: string,
  targetFramework: string,
  onLog?: LogSink
): Promise<RefactorResult> {
  const startTime = Date.now();
  const logs: AgentLog[] = [];
  const usage = newUsageTotals();

  const recordLog = (agent: string, action: string) => {
    const entry = { agent, action, timestamp: new Date().toLocaleTimeString() };
    logs.push(entry);
    console.log(`[${entry.agent}]: ${entry.action}`); // Keeps logs visible in cloud console too
    onLog?.(entry);
  };

  recordLog('System', 'Starting RefactorBot Orchestration Loop...');

  recordLog('Parser', 'Analyzing legacy source code structure...');
  const parsed = await parserAgent(legacyCode);
  trackUsage(usage, 'Parser', parsed.usage);
  const parsedData = parsed.content;

  recordLog('Architect', `Designing target architecture for framework: ${targetFramework}`);
  const architected = await architectAgent(parsedData, targetFramework);
  trackUsage(usage, 'Architect', architected.usage);
  const architectPlan = architected.content;

  recordLog('Developer', 'Drafting initial production-ready code files...');
  const firstDraft = await devAgent(architectPlan, parsedData);
  trackUsage(usage, 'Developer', firstDraft.usage);
  let generatedCode = firstDraft.content;

  let approved = false;
  let attempts = 0;
  let previousObjections = '';
  let finalVerdicts: QaVerdict[] = [];
  const MAX_ATTEMPTS = 3;

  while (!approved && attempts < MAX_ATTEMPTS) {
    attempts++;
    recordLog('QA Panel', `Security, Performance and Correctness reviewers auditing in parallel (Attempt ${attempts}/${MAX_ATTEMPTS})...`);

    // The three specialists review the SAME code concurrently — one wall-clock
    // round-trip instead of three, and genuinely independent opinions.
    const [security, performance, correctness] = await Promise.all([
      securityQaAgent(generatedCode),
      performanceQaAgent(generatedCode),
      correctnessQaAgent(generatedCode, parsedData),
    ]);
    trackUsage(usage, 'Security QA', security.raw.usage);
    trackUsage(usage, 'Performance QA', performance.raw.usage);
    trackUsage(usage, 'Correctness QA', correctness.raw.usage);

    const verdicts = [security.verdict, performance.verdict, correctness.verdict];
    finalVerdicts = verdicts;
    for (const v of verdicts) {
      recordLog(v.reviewer, `${v.approved ? '✅ APPROVED' : '❌ REJECTED'} [${v.severity}] — ${v.feedback}`);
    }

    const rejections = verdicts.filter((v) => !v.approved);
    approved = rejections.length === 0;

    if (approved) {
      recordLog('QA Panel', 'Unanimous approval. Code cleared for production.');
      break;
    }

    // Disagreement inside the society: some reviewers approve, others reject.
    if (rejections.length < verdicts.length) {
      recordLog(
        'System',
        `⚖️ Panel disagreement detected (${verdicts.length - rejections.length} approve / ${rejections.length} reject) — escalating to the Senior Reviewer for arbitration.`
      );
    }

    if (attempts >= MAX_ATTEMPTS) break;

    // Convergence detection: if the objections did not change between two
    // rounds, incremental patching has stalled — the arbiter must impose a
    // different strategy instead of another small diff.
    const objections = rejections.map((v) => `${v.reviewer}:${v.severity}:${v.feedback}`).sort().join('|');
    const stalled = objections === previousObjections && objections !== '';
    previousObjections = objections;
    if (stalled) {
      recordLog('System', '🔁 Negotiation stalled (identical objections twice) — arbiter instructed to change implementation strategy.');
    }

    recordLog('Senior Reviewer', stalled ? 'Imposing an alternative implementation strategy...' : 'Arbitrating panel conflicts into one prioritized fix list...');
    const arbitration = await reviewerAgent(verdicts, generatedCode, stalled);
    trackUsage(usage, 'Senior Reviewer', arbitration.usage);

    recordLog('Developer', 'Rewriting code based on the arbitrated fix list...');
    const rewrite = await devAgent(architectPlan, parsedData + '\n\nARBITRATED FIXES (apply all, in priority order):\n' + arbitration.content);
    trackUsage(usage, 'Developer', rewrite.usage);
    generatedCode = rewrite.content;
  }

  if (approved) {
    recordLog('System', 'Orchestration complete. Writing finalized assets to disk.');
    saveOutput('generated_code.txt', generatedCode, recordLog);
  } else {
    recordLog('System Error', 'Max negotiation cycles reached without unanimous QA approval.');
    saveOutput('generated_code_last.txt', generatedCode, recordLog);
  }

  const durationMs = Date.now() - startTime;
  recordLog(
    'System',
    `Telemetry: ${usage.calls} Qwen calls, ${usage.inputTokens} input / ${usage.outputTokens} output tokens, ${(durationMs / 1000).toFixed(1)}s wall clock.`
  );

  return { generatedCode, approved, attempts, logs, usage, finalVerdicts, durationMs };
}
