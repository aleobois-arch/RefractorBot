import { callLLM } from '../llm';

// The Watcher — triage & severity classification
export async function watcherAgent(incidentDescription: string): Promise<string> {
  const system =
    'You are The Watcher, a SOC triage analyst. Classify the incident. ' +
    'Return ONLY JSON: { "severity": "LOW|MEDIUM|HIGH|CRITICAL", "category": string, ' +
    '"nis2_relevant": boolean, "significant_incident": boolean, "initial_assessment": string, ' +
    '"notification_deadlines": { "early_warning": string, "incident_notification": string, "final_report": string } }. ' +
    'Apply NIS2 Article 23 criteria for significant incidents (24h early warning, 72h notification, 1 month final report).';
  return callLLM('watcher', system, 'Incident report:\n\n' + incidentDescription);
}

// The Tracker — read-only investigation
export async function trackerAgent(incidentDescription: string, triage: string): Promise<string> {
  const system =
    'You are The Tracker, a forensic investigator. You are STRICTLY READ-ONLY: propose no changes, only reconstruct facts. ' +
    'Return ONLY JSON: { "timeline": [{ "time": string, "event": string }], "affected_assets": [string], ' +
    '"indicators_of_compromise": [string], "evidence_collected": [string] }.';
  return callLLM('tracker', system, 'Incident:\n' + incidentDescription + '\n\nTriage:\n' + triage);
}

// The Diagnostician — root-cause analysis
export async function diagnosticianAgent(investigation: string): Promise<string> {
  const system =
    'You are The Diagnostician, a root-cause analyst. From the investigation findings, determine how and why the incident happened. ' +
    'Return ONLY JSON: { "root_cause": string, "attack_vector": string, "contributing_factors": [string], ' +
    '"confidence": "low|medium|high" }.';
  return callLLM('diagnostician', system, 'Investigation findings:\n' + investigation);
}

// The Engineer — remediation & risk
export async function engineerAgent(diagnosis: string, investigation: string): Promise<string> {
  const system =
    'You are The Engineer, an incident remediation lead. Propose containment and remediation with risk awareness. ' +
    'Return ONLY JSON: { "immediate_actions": [string], "remediation_plan": [string], "residual_risk": string }.';
  return callLLM('engineer', system, 'Diagnosis:\n' + diagnosis + '\n\nInvestigation:\n' + investigation);
}

// The Scribe — NIS2 regulatory report
export async function scribeAgent(
  triage: string,
  investigation: string,
  diagnosis: string,
  remediation: string
): Promise<string> {
  const system =
    'You are The Scribe, a compliance officer. Write a formal NIS2 (Directive (EU) 2022/2555, Article 23) incident report in Markdown ' +
    'with sections: Summary, Severity & Classification, Timeline, Root Cause, Remediation, Notification Obligations. ' +
    'Output ONLY the Markdown report.';
  const user =
    'Triage:\n' + triage +
    '\n\nInvestigation:\n' + investigation +
    '\n\nDiagnosis:\n' + diagnosis +
    '\n\nRemediation:\n' + remediation;
  return callLLM('scribe', system, user);
}
