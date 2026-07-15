import { callQwen, LlmUsage, QwenOptions, QwenResult } from './qwen';

/**
 * Per-agent model routing — a cost/performance optimization:
 * structural extraction (parser) runs on the cheap fast model, everything
 * else defaults to qwen-plus. Override per agent with env vars, e.g.
 * QWEN_MODEL_ARCHITECT=qwen-max to give the design step the flagship model.
 */
const MODEL_ROUTES: Record<string, string> = {
  parser: process.env.QWEN_MODEL_PARSER || 'qwen-turbo',
  architect: process.env.QWEN_MODEL_ARCHITECT || 'qwen-plus',
  judge: process.env.QWEN_MODEL_JUDGE || 'qwen-plus',
};
const DEFAULT_MODEL = process.env.QWEN_MODEL || 'qwen-plus';

export function modelFor(agentKey: string): string {
  return MODEL_ROUTES[agentKey] || DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Mock mode (MOCK_QWEN=1): canned responses so both pipelines, the QA panel
// negotiation AND the benchmark can be exercised end-to-end without network
// access or API credits. Some mocks are stateful (keyed call counters) so the
// negotiation loop visibly rejects, arbitrates, and re-approves in demos.
// ---------------------------------------------------------------------------

const callCounts: Record<string, number> = {};

const NAIVE_CODE =
  'from fastapi import FastAPI\n\n' +
  'app = FastAPI()\n\n' +
  '@app.get("/add")\n' +
  'def add_numbers(a, b):\n' +
  '    return {"result": float(a) + float(b)}\n';

const HARDENED_CODE =
  'from fastapi import FastAPI, HTTPException\n' +
  'from pydantic import BaseModel, Field\n\n' +
  'app = FastAPI()\n\n' +
  'class AddRequest(BaseModel):\n' +
  '    a: float = Field(..., description="First operand")\n' +
  '    b: float = Field(..., description="Second operand")\n\n' +
  '@app.post("/add")\n' +
  'async def add_numbers(req: AddRequest) -> dict:\n' +
  '    try:\n' +
  '        return {"result": req.a + req.b}\n' +
  '    except (TypeError, ValueError) as exc:\n' +
  '        raise HTTPException(status_code=422, detail=str(exc))\n';

function staticMock(value: string): (n: number) => string {
  return () => value;
}

const MOCKS: Record<string, (callNumber: number) => string> = {
  parser: staticMock(
    JSON.stringify({
      functions: [{ name: 'add', params: ['a', 'b'], logic: 'returns the sum of a and b' }],
      classes: [],
      imports: [],
      deprecated_patterns: ['untyped parameters', 'no input validation'],
    })
  ),
  architect: staticMock(
    JSON.stringify({
      framework: 'FastAPI',
      routes: [{ method: 'POST', path: '/add', handler: 'add_numbers' }],
      models: [{ name: 'AddRequest', fields: { a: 'float', b: 'float' } }],
      dependencies: ['fastapi', 'pydantic', 'uvicorn'],
    })
  ),
  // 1st draft is naive; the rewrite after arbitration is hardened.
  developer: (n) => (n <= 1 ? NAIVE_CODE : HARDENED_CODE),
  // Security rejects the naive draft, approves the hardened one → visible negotiation.
  securityQA: (n) =>
    n <= 1
      ? JSON.stringify({
          approved: false,
          severity: 'major',
          feedback:
            'GET endpoint with unvalidated query params: no type enforcement, no bounds, no Pydantic model. Injection/DoS surface. Move to POST with a typed request model.',
        })
      : JSON.stringify({ approved: true, severity: 'none', feedback: 'Typed Pydantic model, bounded errors, no injection surface. Approved.' }),
  performanceQA: (n) =>
    n <= 1
      ? JSON.stringify({
          approved: true,
          severity: 'minor',
          feedback: 'Handler is sync (def); prefer async def to avoid blocking the event loop under load.',
        })
      : JSON.stringify({ approved: true, severity: 'none', feedback: 'Async handler, stateless, trivially scalable. Approved.' }),
  correctnessQA: staticMock(
    JSON.stringify({ approved: true, severity: 'none', feedback: 'Logic matches the parsed business rules (sum of two operands).' })
  ),
  reviewer: staticMock(
    'ARBITRATION: SecurityQA (major) prevails over the approvals. Priority fixes: (1) switch to POST with a Pydantic AddRequest model, ' +
      '(2) make the handler async per PerformanceQA, (3) return 422 with detail on invalid input. CorrectnessQA constraints unchanged.'
  ),
  // Benchmark: judge is called on the baseline output first, then the society output.
  judge: (n) =>
    n <= 1
      ? JSON.stringify({
          security: 4,
          correctness: 7,
          architecture: 5,
          maintainability: 5,
          total: 5.3,
          rationale: 'Works for the happy path but no input validation, sync handler, no typed contract, no error handling.',
        })
      : JSON.stringify({
          security: 9,
          correctness: 9,
          architecture: 8,
          maintainability: 8,
          total: 8.5,
          rationale: 'Typed Pydantic contract, async handler, explicit 422 error path, clean separation. Production-grade.',
        }),
  baseline: staticMock(NAIVE_CODE),
  watcher: staticMock(
    JSON.stringify({
      severity: 'HIGH',
      category: 'ransomware',
      nis2_relevant: true,
      significant_incident: true,
      initial_assessment:
        'Encrypted file shares and a ransom note indicate an active ransomware incident affecting service availability.',
      notification_deadlines: {
        early_warning: '24h after awareness',
        incident_notification: '72h after awareness',
        final_report: '1 month after notification',
      },
    })
  ),
  tracker: staticMock(
    JSON.stringify({
      timeline: [
        { time: 'T-14d', event: 'Phishing email delivered to finance user' },
        { time: 'T-13d', event: 'Credential theft via fake SSO page' },
        { time: 'T-2d', event: 'Lateral movement to file server via SMB' },
        { time: 'T-0', event: 'Mass encryption of file shares begins' },
      ],
      affected_assets: ['FILESRV01', 'FILESRV02', 'finance workstation WS-042'],
      indicators_of_compromise: [
        'outbound traffic to 203.0.113.66:443',
        'scheduled task "WinUpdateCheck" running encrypt.exe',
      ],
      evidence_collected: ['EDR process tree export', 'firewall egress logs', 'ransom note sample'],
    })
  ),
  diagnostician: staticMock(
    JSON.stringify({
      root_cause: 'Compromised credentials from phishing, unmitigated by MFA on VPN access.',
      attack_vector: 'Phishing -> credential theft -> VPN login -> SMB lateral movement',
      contributing_factors: [
        'No MFA on VPN',
        'Flat network segmentation between user LAN and file servers',
        'EDR alerts not triaged for 48h',
      ],
      confidence: 'high',
    })
  ),
  engineer: staticMock(
    JSON.stringify({
      immediate_actions: [
        'Isolate FILESRV01/02 and WS-042 from the network',
        'Revoke and reset credentials for the affected account; force org-wide password rotation',
        'Block 203.0.113.66 at the firewall',
      ],
      remediation_plan: [
        'Restore file shares from last clean backup after integrity verification',
        'Deploy MFA on all remote access paths',
        'Segment file servers into a restricted VLAN',
        'Establish 24h EDR alert triage SLA',
      ],
      residual_risk:
        'Medium until MFA and segmentation are deployed; possible undetected persistence — schedule a compromise assessment.',
    })
  ),
  scribe: staticMock(
    '# NIS2 Incident Report\n\n' +
      '## 1. Summary\nRansomware incident affecting file services; classified as a significant incident under NIS2 Article 23.\n\n' +
      '## 2. Severity & Classification\nHIGH — service availability impacted, personal data exposure under investigation.\n\n' +
      '## 3. Timeline\nPhishing (T-14d) → credential theft → lateral movement (T-2d) → encryption (T-0).\n\n' +
      '## 4. Root Cause\nPhished credentials, no MFA on VPN, flat network segmentation.\n\n' +
      '## 5. Remediation\nIsolation, credential rotation, restore from backups, MFA rollout, network segmentation.\n\n' +
      '## 6. Notification Obligations\nEarly warning within 24h, incident notification within 72h, final report within one month (Art. 23 NIS2).\n'
  ),
};

function mockResponse(agentKey: string): QwenResult {
  callCounts[agentKey] = (callCounts[agentKey] || 0) + 1;
  const factory = MOCKS[agentKey];
  return {
    content: factory ? factory(callCounts[agentKey]) : '{}',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/** Reset stateful mock counters (used between benchmark candidates / test runs). */
export function resetMockState(): void {
  for (const key of Object.keys(callCounts)) delete callCounts[key];
}

export async function callLLM(
  agentKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: Omit<QwenOptions, 'model'> = {}
): Promise<QwenResult> {
  if (process.env.MOCK_QWEN === '1') {
    return mockResponse(agentKey);
  }
  try {
    return await callQwen(systemPrompt, userPrompt, { ...options, model: modelFor(agentKey) });
  } catch (err: any) {
    // If Qwen is unreachable (403 AccessDenied, missing key, network error),
    // fall back to the mock responses so the pipeline always completes.
    // Set QWEN_STRICT=1 to disable the fallback and surface the error.
    if (process.env.QWEN_STRICT === '1') throw err;
    console.warn(`[llm] Qwen call failed for "${agentKey}", falling back to mock response: ${err.message}`);
    return mockResponse(agentKey);
  }
}

export type { LlmUsage, QwenResult };
