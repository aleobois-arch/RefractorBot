import { callQwen } from './qwen';

// Canned responses used when MOCK_QWEN=1, so the pipeline can be
// exercised end-to-end without network access or API credits.
const MOCKS: Record<string, string> = {
  parser: JSON.stringify({
    functions: [{ name: 'add', params: ['a', 'b'], logic: 'returns the sum of a and b' }],
    classes: [],
    imports: [],
    deprecated_patterns: ['untyped parameters', 'no input validation'],
  }),
  architect: JSON.stringify({
    framework: 'FastAPI',
    routes: [{ method: 'POST', path: '/add', handler: 'add_numbers' }],
    models: [{ name: 'AddRequest', fields: { a: 'float', b: 'float' } }],
    dependencies: ['fastapi', 'pydantic', 'uvicorn'],
  }),
  developer:
    'from fastapi import FastAPI\n' +
    'from pydantic import BaseModel\n\n' +
    'app = FastAPI()\n\n' +
    'class AddRequest(BaseModel):\n' +
    '    a: float\n' +
    '    b: float\n\n' +
    '@app.post("/add")\n' +
    'async def add_numbers(req: AddRequest) -> dict:\n' +
    '    return {"result": req.a + req.b}\n',
  qa: JSON.stringify({
    approved: true,
    feedback: 'Typed models, async handler, no resource leaks. Approved.',
  }),
  reviewer: 'No outstanding issues; QA already approved the implementation.',
  watcher: JSON.stringify({
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
  }),
  tracker: JSON.stringify({
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
  }),
  diagnostician: JSON.stringify({
    root_cause: 'Compromised credentials from phishing, unmitigated by MFA on VPN access.',
    attack_vector: 'Phishing -> credential theft -> VPN login -> SMB lateral movement',
    contributing_factors: [
      'No MFA on VPN',
      'Flat network segmentation between user LAN and file servers',
      'EDR alerts not triaged for 48h',
    ],
    confidence: 'high',
  }),
  engineer: JSON.stringify({
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
  }),
  scribe:
    '# NIS2 Incident Report\n\n' +
    '## 1. Summary\nRansomware incident affecting file services; classified as a significant incident under NIS2 Article 23.\n\n' +
    '## 2. Severity & Classification\nHIGH — service availability impacted, personal data exposure under investigation.\n\n' +
    '## 3. Timeline\nPhishing (T-14d) → credential theft → lateral movement (T-2d) → encryption (T-0).\n\n' +
    '## 4. Root Cause\nPhished credentials, no MFA on VPN, flat network segmentation.\n\n' +
    '## 5. Remediation\nIsolation, credential rotation, restore from backups, MFA rollout, network segmentation.\n\n' +
    '## 6. Notification Obligations\nEarly warning within 24h, incident notification within 72h, final report within one month (Art. 23 NIS2).\n',
};

export async function callLLM(agentKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  if (process.env.MOCK_QWEN === '1') {
    return MOCKS[agentKey] ?? '{}';
  }
  return callQwen(systemPrompt, userPrompt);
}
