import { watcherAgent, trackerAgent, diagnosticianAgent, engineerAgent, scribeAgent } from './agents';
import { AgentLog } from '../orchestrator';

export interface Nis2Result {
  triage: string;
  investigation: string;
  diagnosis: string;
  remediation: string;
  report: string;
  logs: AgentLog[];
}

export async function runIncidentResponse(incidentDescription: string): Promise<Nis2Result> {
  const logs: AgentLog[] = [];
  const recordLog = (agent: string, action: string) => {
    const entry = { agent, action, timestamp: new Date().toLocaleTimeString() };
    logs.push(entry);
    console.log(`[${entry.agent}]: ${entry.action}`);
  };

  recordLog('System', 'Starting NIS2 Incident Response pipeline...');

  recordLog('The Watcher', 'Triaging incident and assessing severity...');
  const triage = await watcherAgent(incidentDescription);

  recordLog('The Tracker', 'Running read-only investigation...');
  const investigation = await trackerAgent(incidentDescription, triage);

  recordLog('The Diagnostician', 'Performing root-cause analysis...');
  const diagnosis = await diagnosticianAgent(investigation);

  recordLog('The Engineer', 'Drafting remediation plan and risk assessment...');
  const remediation = await engineerAgent(diagnosis, investigation);

  recordLog('The Scribe', 'Writing the NIS2 regulatory report...');
  const report = await scribeAgent(triage, investigation, diagnosis, remediation);

  recordLog('System', 'Incident response pipeline complete.');

  return { triage, investigation, diagnosis, remediation, report, logs };
}
