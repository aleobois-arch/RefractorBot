import { watcherAgent, trackerAgent, diagnosticianAgent, engineerAgent, scribeAgent } from './agents';
import { AgentLog, LogSink, newUsageTotals, trackUsage, UsageTotals } from '../orchestrator';

export interface Nis2Result {
  triage: string;
  investigation: string;
  diagnosis: string;
  remediation: string;
  report: string;
  logs: AgentLog[];
  usage: UsageTotals;
  durationMs: number;
}

export async function runIncidentResponse(incidentDescription: string, onLog?: LogSink): Promise<Nis2Result> {
  const startTime = Date.now();
  const logs: AgentLog[] = [];
  const usage = newUsageTotals();
  const recordLog = (agent: string, action: string) => {
    const entry = { agent, action, timestamp: new Date().toLocaleTimeString() };
    logs.push(entry);
    console.log(`[${entry.agent}]: ${entry.action}`);
    onLog?.(entry);
  };

  recordLog('System', 'Starting NIS2 Incident Response pipeline...');

  recordLog('The Watcher', 'Triaging incident and assessing severity...');
  const triage = await watcherAgent(incidentDescription);
  trackUsage(usage, 'The Watcher', triage.usage);

  recordLog('The Tracker', 'Running read-only investigation...');
  const investigation = await trackerAgent(incidentDescription, triage.content);
  trackUsage(usage, 'The Tracker', investigation.usage);

  recordLog('The Diagnostician', 'Performing root-cause analysis...');
  const diagnosis = await diagnosticianAgent(investigation.content);
  trackUsage(usage, 'The Diagnostician', diagnosis.usage);

  recordLog('The Engineer', 'Drafting remediation plan and risk assessment...');
  const remediation = await engineerAgent(diagnosis.content, investigation.content);
  trackUsage(usage, 'The Engineer', remediation.usage);

  recordLog('The Scribe', 'Writing the NIS2 regulatory report...');
  const report = await scribeAgent(triage.content, investigation.content, diagnosis.content, remediation.content);
  trackUsage(usage, 'The Scribe', report.usage);

  const durationMs = Date.now() - startTime;
  recordLog('System', `Incident response pipeline complete (${usage.calls} Qwen calls, ${(durationMs / 1000).toFixed(1)}s).`);

  return {
    triage: triage.content,
    investigation: investigation.content,
    diagnosis: diagnosis.content,
    remediation: remediation.content,
    report: report.content,
    logs,
    usage,
    durationMs,
  };
}
