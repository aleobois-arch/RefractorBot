import { callLLM, QwenResult } from './llm';

export type QaSeverity = 'none' | 'minor' | 'major' | 'blocker';

export interface QaVerdict {
  reviewer: string;
  approved: boolean;
  severity: QaSeverity;
  feedback: string;
}

/** Extract the first JSON object from an LLM response (handles ```json fences and prose). */
export function extractJson<T>(raw: string, fallback: T): T {
  const cleaned = raw.replace(/```json\n?|```/g, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try next candidate */
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Build pipeline agents
// ---------------------------------------------------------------------------

export async function parserAgent(code: string): Promise<QwenResult> {
  const system =
    'You are a Senior Code Parser. Extract functions, classes, imports, and business logic from legacy code. ' +
    'Also list deprecated or dangerous patterns you detect. Return ONLY JSON: ' +
    '{ "functions": [...], "classes": [...], "imports": [...], "deprecated_patterns": [string] }';
  return callLLM('parser', system, 'Parse this code:\n\n' + code);
}

export async function architectAgent(parsedData: string, targetFramework: string): Promise<QwenResult> {
  const system =
    'You are a Software Architect. Design the target framework structure for the parsed legacy logic: ' +
    'routes, typed request/response models, dependencies, and error-handling strategy. ' +
    'Favor modularity and production-readiness. Return ONLY JSON with routes, models, dependencies, error_strategy.';
  return callLLM('architect', system, 'Parsed data: ' + parsedData + '\nTarget: ' + targetFramework);
}

export async function devAgent(architectPlan: string, parsedData: string): Promise<QwenResult> {
  const system =
    'You are a Senior Developer. Write executable, production-grade code for the target framework: ' +
    'typed models, async handlers where idiomatic, explicit error handling. Output ONLY the code files.';
  return callLLM('developer', system, 'Architect Plan: ' + architectPlan + '\n\nParsed Data: ' + parsedData);
}

// ---------------------------------------------------------------------------
// QA review panel — three specialized reviewers run IN PARALLEL and can
// disagree; the Senior Reviewer arbitrates conflicts (Track 3: negotiation
// and conflict resolution inside the agent society).
// ---------------------------------------------------------------------------

const VERDICT_FORMAT =
  'Return ONLY JSON: { "approved": boolean, "severity": "none"|"minor"|"major"|"blocker", "feedback": string }. ' +
  'severity reflects your WORST finding. approved=false only for major or blocker findings.';

async function runQa(agentKey: string, reviewer: string, systemRole: string, generatedCode: string): Promise<{ verdict: QaVerdict; raw: QwenResult }> {
  const raw = await callLLM(agentKey, systemRole + ' ' + VERDICT_FORMAT, 'Code under review:\n\n' + generatedCode);
  const parsed = extractJson<Partial<QaVerdict>>(raw.content, {});
  const severities: QaSeverity[] = ['none', 'minor', 'major', 'blocker'];
  return {
    raw,
    verdict: {
      reviewer,
      approved: typeof parsed.approved === 'boolean' ? parsed.approved : false,
      severity: severities.includes(parsed.severity as QaSeverity) ? (parsed.severity as QaSeverity) : 'major',
      feedback: parsed.feedback || raw.content.slice(0, 300),
    },
  };
}

export function securityQaAgent(generatedCode: string) {
  return runQa(
    'securityQA',
    'Security QA',
    'You are a ruthless Application Security reviewer. Hunt for injection surfaces, unvalidated inputs, SSRF, ' +
      'secrets in code, unsafe deserialization, missing authn/authz assumptions, and CORS misconfigurations.',
    generatedCode
  );
}

export function performanceQaAgent(generatedCode: string) {
  return runQa(
    'performanceQA',
    'Performance QA',
    'You are a Performance & Reliability reviewer. Hunt for resource leaks, blocking calls in async contexts, ' +
      'unbounded memory growth, missing timeouts, and N+1 patterns.',
    generatedCode
  );
}

export function correctnessQaAgent(generatedCode: string, parsedData: string) {
  return runQa(
    'correctnessQA',
    'Correctness QA',
    'You are a Correctness reviewer. Verify the generated code preserves the original business logic exactly ' +
      '(same behavior, same edge cases) as described here: ' +
      parsedData.slice(0, 1500),
    generatedCode
  );
}

/**
 * The Senior Reviewer arbitrates the panel: reconciles conflicting verdicts,
 * prioritizes fixes (blocker > major > minor), and — when the negotiation has
 * stalled (same feedback twice) — imposes a different implementation strategy.
 */
export async function reviewerAgent(
  verdicts: QaVerdict[],
  generatedCode: string,
  stalled: boolean
): Promise<QwenResult> {
  const system =
    'You are the Senior Reviewer arbitrating a panel of three QA specialists who may disagree. ' +
    'Reconcile their verdicts into ONE prioritized, actionable fix list for the Developer ' +
    '(blocker first, then major, then minor). When reviewers conflict, security prevails over style, ' +
    'and correctness constraints must never be broken by a fix.' +
    (stalled
      ? ' The negotiation has STALLED (same objections twice): impose a substantially different implementation strategy instead of incremental patches.'
      : '');
  const user =
    'PANEL VERDICTS:\n' +
    verdicts.map((v) => `- ${v.reviewer} [${v.approved ? 'APPROVED' : 'REJECTED'} / ${v.severity}]: ${v.feedback}`).join('\n') +
    '\n\nCODE:\n' +
    generatedCode;
  return callLLM('reviewer', system, user);
}
