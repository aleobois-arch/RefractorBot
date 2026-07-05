import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import { runRefactorBot } from './orchestrator';
import { runIncidentResponse } from './nis2/orchestrator';

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// ROUTE 1: The Interactive Browser Dashboard
// ---------------------------------------------------------
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RefactorBot | Agent Society</title>
      <style>
        :root { --primary: #3b82f6; --bg: #0f172a; --surface: rgba(30, 41, 59, 0.7); --text: #f8fafc; }
        body { font-family: 'Inter', system-ui, sans-serif; background-color: var(--bg); color: var(--text); padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
        h1 { font-size: 2.5rem; margin-bottom: 0.5rem; background: linear-gradient(to right, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .glass-panel { background: var(--surface); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; }
        textarea { width: 100%; height: 150px; background: rgba(0,0,0,0.3); color: #10b981; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem; font-family: monospace; resize: vertical; box-sizing: border-box; margin-bottom: 1rem; }
        button { background: var(--primary); color: white; border: none; padding: 0.75rem 2rem; font-weight: bold; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
        button:hover { background: #2563eb; transform: translateY(-1px); }
        button:disabled { background: #475569; cursor: not-allowed; }
        
        .timeline-item { border-left: 3px solid var(--primary); padding-left: 1.5rem; margin-bottom: 1.5rem; position: relative; }
        .timeline-item::before { content: ''; position: absolute; left: -7px; top: 0; width: 11px; height: 11px; background: var(--primary); border-radius: 50%; }
        .agent-badge { display: inline-block; background: rgba(59, 130, 246, 0.2); color: #93c5fd; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.85rem; font-weight: bold; margin-bottom: 0.5rem; }
        .timestamp { color: #94a3b8; font-size: 0.8rem; margin-left: 0.5rem; }
        pre { background: rgba(0,0,0,0.5); padding: 1.5rem; border-radius: 8px; overflow-x: auto; border: 1px solid rgba(255,255,255,0.05); }
        code { font-family: monospace; color: #e2e8f0; }
        
        #results { display: none; }
        #loading { display: none; color: #60a5fa; font-weight: bold; margin-top: 1rem; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
      </style>
    </head>
    <body>
      <h1>🤖 RefactorBot Society</h1>
      <p style="color: #94a3b8; margin-bottom: 2rem;">Track 3: Autonomous Multi-Agent Code Refactoring powered by Qwen Cloud.</p>
      
      <div class="glass-panel">
        <textarea id="codeInput" placeholder="Paste your legacy code here..."></textarea>
        <button id="runBtn">Initiate Agent Protocol</button>
        <div id="loading">Establishing connection to agent society... please wait.</div>
      </div>

      <div id="results">
        <h2>Communication Timeline</h2>
        <div class="glass-panel" id="timelineBox"></div>
        
        <h2>Production Code Output</h2>
        <pre><code id="finalCodeBox"></code></pre>
      </div>

      <script>
        document.getElementById('runBtn').addEventListener('click', async () => {
          const code = document.getElementById('codeInput').value;
          if (!code.trim()) return alert('Please enter some code.');

          const btn = document.getElementById('runBtn');
          const loading = document.getElementById('loading');
          const results = document.getElementById('results');
          const timelineBox = document.getElementById('timelineBox');
          const finalCodeBox = document.getElementById('finalCodeBox');

          btn.disabled = true;
          loading.style.display = 'block';
          results.style.display = 'none';
          timelineBox.innerHTML = '';
          finalCodeBox.textContent = '';

          try {
            const response = await fetch('/refactor', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ legacyCode: code, targetFramework: 'FastAPI' })
            });
            
            const data = await response.json();
            
            if (data.success && data.timeline) {
              data.timeline.forEach(log => {
                const div = document.createElement('div');
                div.className = 'timeline-item';
                const badge = document.createElement('div');
                badge.className = 'agent-badge';
                badge.textContent = log.agent;
                const ts = document.createElement('span');
                ts.className = 'timestamp';
                ts.textContent = '[' + log.timestamp + ']';
                const action = document.createElement('div');
                action.style.marginTop = '0.25rem';
                action.textContent = log.action;
                div.append(badge, ts, action);
                timelineBox.appendChild(div);
              });
              finalCodeBox.textContent = data.generatedCode;
              results.style.display = 'block';
            } else {
              alert('Error during execution. Check console.');
            }
          } catch (err) {
            alert('Request failed: ' + err.message);
          } finally {
            btn.disabled = false;
            loading.style.display = 'none';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ---------------------------------------------------------
// ROUTE 2: The Multi-Agent API (Listens to both paths)
// ---------------------------------------------------------
app.post(['/refactor', '/invoke'], async (req, res) => {
  try {
    const { legacyCode, targetFramework } = req.body;
    const codeToRefactor = legacyCode || `function add(a, b) { return a + b; }`;
    const framework = targetFramework || 'FastAPI';

    console.log('🚀 Triggering RefactorBot via API...');
    
    // Calls the orchestrator you already built perfectly
    const result = await runRefactorBot(codeToRefactor, framework);

    res.json({
      success: true,
      message: 'RefactorBot execution complete!',
      approved: result.approved,
      timeline: result.logs,
      generatedCode: result.generatedCode
    });
    
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ---------------------------------------------------------
// ROUTE 3: NIS2 Incident Response Dashboard
// ---------------------------------------------------------
app.get('/nis2', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>NIS2 | Agent Society</title>
      <style>
        :root { --primary: #10b981; --bg: #0f172a; --surface: rgba(30, 41, 59, 0.7); --text: #f8fafc; }
        body { font-family: 'Inter', system-ui, sans-serif; background-color: var(--bg); color: var(--text); padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
        h1 { font-size: 2.5rem; margin-bottom: 0.5rem; background: linear-gradient(to right, #34d399, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .glass-panel { background: var(--surface); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; }
        textarea { width: 100%; height: 150px; background: rgba(0,0,0,0.3); color: #34d399; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem; font-family: monospace; resize: vertical; box-sizing: border-box; margin-bottom: 1rem; }
        button { background: var(--primary); color: white; border: none; padding: 0.75rem 2rem; font-weight: bold; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
        button:hover { background: #059669; transform: translateY(-1px); }
        button:disabled { background: #475569; cursor: not-allowed; }
        .steps { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 2rem; }
        .step { flex: 1 1 140px; background: var(--surface); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0.75rem 1rem; }
        .step .num { display: inline-block; width: 1.5rem; height: 1.5rem; line-height: 1.5rem; text-align: center; border-radius: 50%; background: rgba(16,185,129,0.25); color: #6ee7b7; font-weight: bold; font-size: 0.85rem; margin-bottom: 0.4rem; }
        .step .name { font-weight: bold; font-size: 0.95rem; }
        .step .role { color: #94a3b8; font-size: 0.8rem; }
        .step.done { border-color: #10b981; }
        .step.done .num { background: #10b981; color: white; }
        .timeline-item { border-left: 3px solid var(--primary); padding-left: 1.5rem; margin-bottom: 1.5rem; position: relative; }
        .timeline-item::before { content: ''; position: absolute; left: -7px; top: 0; width: 11px; height: 11px; background: var(--primary); border-radius: 50%; }
        .agent-badge { display: inline-block; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.85rem; font-weight: bold; margin-bottom: 0.5rem; }
        .timestamp { color: #94a3b8; font-size: 0.8rem; margin-left: 0.5rem; }
        pre { background: rgba(0,0,0,0.5); padding: 1.5rem; border-radius: 8px; overflow-x: auto; border: 1px solid rgba(255,255,255,0.05); white-space: pre-wrap; }
        code { font-family: monospace; color: #e2e8f0; }
        #results { display: none; }
        #loading { display: none; color: #34d399; font-weight: bold; margin-top: 1rem; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
      </style>
    </head>
    <body>
      <h1>🛡️ NIS2 Agent Society</h1>
      <p style="color: #94a3b8; margin-bottom: 2rem;">Autonomous incident response & NIS2 reporting powered by Qwen Cloud.</p>

      <div class="steps">
        <div class="step" id="step-watcher"><span class="num">1</span><div class="name">The Watcher</div><div class="role">Triage & severity</div></div>
        <div class="step" id="step-tracker"><span class="num">2</span><div class="name">The Tracker</div><div class="role">Read-only investigation</div></div>
        <div class="step" id="step-diagnostician"><span class="num">3</span><div class="name">The Diagnostician</div><div class="role">Root-cause analysis</div></div>
        <div class="step" id="step-engineer"><span class="num">4</span><div class="name">The Engineer</div><div class="role">Remediation & risk</div></div>
        <div class="step" id="step-scribe"><span class="num">5</span><div class="name">The Scribe</div><div class="role">NIS2 report</div></div>
      </div>

      <div class="glass-panel">
        <textarea id="incidentInput" placeholder="Describe the security incident here..."></textarea>
        <button id="runBtn">Launch Incident Response</button>
        <div id="loading">Agent society investigating... please wait.</div>
      </div>

      <div id="results">
        <h2>Response Timeline</h2>
        <div class="glass-panel" id="timelineBox"></div>

        <h2>NIS2 Report</h2>
        <pre><code id="reportBox"></code></pre>
      </div>

      <script>
        const AGENT_STEPS = {
          'The Watcher': 'step-watcher',
          'The Tracker': 'step-tracker',
          'The Diagnostician': 'step-diagnostician',
          'The Engineer': 'step-engineer',
          'The Scribe': 'step-scribe'
        };

        document.getElementById('runBtn').addEventListener('click', async () => {
          const incident = document.getElementById('incidentInput').value;
          if (!incident.trim()) return alert('Please describe the incident.');

          const btn = document.getElementById('runBtn');
          const loading = document.getElementById('loading');
          const results = document.getElementById('results');
          const timelineBox = document.getElementById('timelineBox');
          const reportBox = document.getElementById('reportBox');

          btn.disabled = true;
          loading.style.display = 'block';
          results.style.display = 'none';
          timelineBox.innerHTML = '';
          reportBox.textContent = '';
          Object.values(AGENT_STEPS).forEach(id => document.getElementById(id).classList.remove('done'));

          try {
            const response = await fetch('/incident', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ incident })
            });

            const data = await response.json();

            if (data.success && data.timeline) {
              data.timeline.forEach(log => {
                const stepId = AGENT_STEPS[log.agent];
                if (stepId) document.getElementById(stepId).classList.add('done');

                const div = document.createElement('div');
                div.className = 'timeline-item';
                const badge = document.createElement('div');
                badge.className = 'agent-badge';
                badge.textContent = log.agent;
                const ts = document.createElement('span');
                ts.className = 'timestamp';
                ts.textContent = '[' + log.timestamp + ']';
                const action = document.createElement('div');
                action.style.marginTop = '0.25rem';
                action.textContent = log.action;
                div.append(badge, ts, action);
                timelineBox.appendChild(div);
              });
              reportBox.textContent = data.report;
              results.style.display = 'block';
            } else {
              alert('Error during execution: ' + (data.error || 'unknown'));
            }
          } catch (err) {
            alert('Request failed: ' + err.message);
          } finally {
            btn.disabled = false;
            loading.style.display = 'none';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ---------------------------------------------------------
// ROUTE 4: NIS2 Incident Response API
// ---------------------------------------------------------
app.post('/incident', async (req, res) => {
  try {
    const { incident } = req.body;
    if (!incident || !String(incident).trim()) {
      return res.status(400).json({ success: false, error: 'Missing "incident" description in request body.' });
    }

    console.log('🛡️ Triggering NIS2 Incident Response via API...');
    const result = await runIncidentResponse(String(incident));

    res.json({
      success: true,
      message: 'NIS2 incident response complete!',
      timeline: result.logs,
      triage: result.triage,
      investigation: result.investigation,
      diagnosis: result.diagnosis,
      remediation: result.remediation,
      report: result.report
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ---------------------------------------------------------
// SERVER INITIALIZATION
// ---------------------------------------------------------
const PORT = Number(process.env.PORT) || 9000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});