import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import { runRefactorBot, AgentLog, LogSink } from './orchestrator';
import { runIncidentResponse } from './nis2/orchestrator';
import { runBenchmark } from './benchmark';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------
// Generic background-run store + SSE event bus, so every
// pipeline (refactor / nis2 / benchmark) can stream its agent
// negotiation live to the dashboards.
// ---------------------------------------------------------

interface RunState {
  id: string;
  logs: AgentLog[];
  done: boolean;
  result?: unknown;
  error?: string;
  bus: EventEmitter;
}

const runs = new Map<string, RunState>();
const MAX_RUNS = 100;

function startRun(task: (log: LogSink) => Promise<unknown>): RunState {
  const id = `RUN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const state: RunState = { id, logs: [], done: false, bus: new EventEmitter() };
  state.bus.setMaxListeners(50);
  runs.set(id, state);
  if (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest) runs.delete(oldest);
  }
  task((entry) => {
    state.logs.push(entry);
    state.bus.emit('event', { type: 'log', data: entry });
  })
    .then((result) => {
      state.done = true;
      state.result = result;
      state.bus.emit('event', { type: 'done', data: result });
    })
    .catch((err: any) => {
      state.done = true;
      state.error = err.message;
      state.bus.emit('event', { type: 'error', data: err.message });
    });
  return state;
}

app.get('/run/:id/events', (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) return res.status(404).json({ error: 'Unknown run id' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event: { type: string; data: unknown }) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  for (const entry of state.logs) send({ type: 'log', data: entry });
  if (state.done) send(state.error ? { type: 'error', data: state.error } : { type: 'done', data: state.result });

  const listener = (event: { type: string; data: unknown }) => send(event);
  state.bus.on('event', listener);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    state.bus.off('event', listener);
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'RefactorBot-Society',
    version: '2.0.0',
    mode: process.env.MOCK_QWEN === '1' ? 'mock' : 'live',
  });
});

// ---------------------------------------------------------
// ROUTE 1: The Interactive Browser Dashboard (live SSE)
// ---------------------------------------------------------
app.get('/', (_req, res) => {
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
        body { font-family: 'Inter', system-ui, sans-serif; background-color: var(--bg); color: var(--text); padding: 2rem; max-width: 980px; margin: 0 auto; line-height: 1.6; }
        h1 { font-size: 2.5rem; margin-bottom: 0.5rem; background: linear-gradient(to right, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        h2 { margin-top: 2rem; }
        .glass-panel { background: var(--surface); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; }
        textarea { width: 100%; height: 150px; background: rgba(0,0,0,0.3); color: #10b981; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem; font-family: monospace; resize: vertical; box-sizing: border-box; margin-bottom: 1rem; }
        button { background: var(--primary); color: white; border: none; padding: 0.75rem 2rem; font-weight: bold; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-right: .6rem; }
        button:hover { background: #2563eb; transform: translateY(-1px); }
        button:disabled { background: #475569; cursor: not-allowed; }
        button.alt { background: #8b5cf6; } button.alt:hover { background: #7c3aed; }
        button.ghost { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #94a3b8; font-weight: 500; padding: .5rem 1rem; }
        .timeline-item { border-left: 3px solid var(--primary); padding-left: 1.5rem; margin-bottom: 1.2rem; position: relative; }
        .timeline-item::before { content: ''; position: absolute; left: -7px; top: 0; width: 11px; height: 11px; background: var(--primary); border-radius: 50%; }
        .agent-badge { display: inline-block; background: rgba(59, 130, 246, 0.2); color: #93c5fd; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.85rem; font-weight: bold; margin-bottom: 0.3rem; }
        .timestamp { color: #94a3b8; font-size: 0.8rem; margin-left: 0.5rem; }
        pre { background: rgba(0,0,0,0.5); padding: 1.5rem; border-radius: 8px; overflow-x: auto; border: 1px solid rgba(255,255,255,0.05); }
        code { font-family: monospace; color: #e2e8f0; }
        table { width: 100%; border-collapse: collapse; font-size: .92rem; }
        th, td { border: 1px solid rgba(255,255,255,0.12); padding: .55rem .8rem; text-align: left; }
        th { background: rgba(59,130,246,.12); color: #93c5fd; }
        .win { color: #34d399; font-weight: bold; }
        #results, #benchResults { display: none; }
        #loading { display: none; color: #60a5fa; font-weight: bold; margin-top: 1rem; animation: pulse 2s infinite; }
        .verdicts { display: flex; gap: .6rem; flex-wrap: wrap; margin: .8rem 0; }
        .verdict { border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: .5rem .9rem; font-size: .85rem; }
        .verdict.ok { border-color: #10b981; color: #6ee7b7; }
        .verdict.ko { border-color: #ef4444; color: #fca5a5; }
        .telemetry { color: #94a3b8; font-size: .85rem; margin-top: .6rem; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
      </style>
    </head>
    <body>
      <h1>🤖 RefactorBot Society</h1>
      <p style="color: #94a3b8; margin-bottom: 2rem;">Track 3: Autonomous Multi-Agent Code Refactoring powered by Qwen Cloud — with a parallel QA review panel, conflict arbitration, and a measurable single-agent benchmark. <a href="/nis2" style="color:#60a5fa;">NIS2 incident response →</a></p>

      <div class="glass-panel">
        <textarea id="codeInput" placeholder="Paste your legacy code here..."></textarea>
        <button id="runBtn">Initiate Agent Protocol</button>
        <button id="benchBtn" class="alt">🏁 Benchmark vs Single Agent</button>
        <button id="sampleBtn" class="ghost">Load sample legacy code</button>
        <div id="loading">Agent society negotiating… follow the live timeline below.</div>
      </div>

      <div id="results">
        <h2>Communication Timeline <span id="liveDot" style="color:#34d399;font-size:.8rem;">● live</span></h2>
        <div class="glass-panel" id="timelineBox"></div>
        <h2>QA Panel Verdicts</h2>
        <div class="verdicts" id="verdictBox"></div>
        <h2>Production Code Output</h2>
        <pre><code id="finalCodeBox"></code></pre>
        <div class="telemetry" id="telemetryBox"></div>
      </div>

      <div id="benchResults">
        <h2>🏁 Benchmark — Agent Society vs Single-Agent Baseline</h2>
        <div class="glass-panel">
          <table id="benchTable"></table>
          <div class="telemetry" id="benchSummary"></div>
        </div>
        <h2>Society output</h2><pre><code id="benchSocietyCode"></code></pre>
        <h2>Baseline output</h2><pre><code id="benchBaselineCode"></code></pre>
      </div>

      <script>
        const $ = (id) => document.getElementById(id);
        const SAMPLE = 'def get_user(id, db):\\n    q = "SELECT * FROM users WHERE id = " + id\\n    cur = db.cursor()\\n    cur.execute(q)\\n    row = cur.fetchone()\\n    return {"name": row[1], "email": row[2]}';
        $('sampleBtn').addEventListener('click', () => { $('codeInput').value = SAMPLE.replace(/\\\\n/g, '\\n'); });

        function addLog(box, log) {
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
          box.appendChild(div);
          div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        async function startAndStream(url, body, onLog, onDone) {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const { runId } = await res.json();
          const es = new EventSource('/run/' + runId + '/events');
          es.onmessage = (msg) => {
            const { type, data } = JSON.parse(msg.data);
            if (type === 'log') onLog(data);
            if (type === 'done') { es.close(); onDone(data); }
            if (type === 'error') { es.close(); alert('Pipeline error: ' + data); $('loading').style.display = 'none'; }
          };
        }

        $('runBtn').addEventListener('click', async () => {
          const code = $('codeInput').value;
          if (!code.trim()) return alert('Please enter some code.');
          $('runBtn').disabled = $('benchBtn').disabled = true;
          $('loading').style.display = 'block';
          $('benchResults').style.display = 'none';
          $('results').style.display = 'block';
          $('timelineBox').innerHTML = ''; $('verdictBox').innerHTML = '';
          $('finalCodeBox').textContent = ''; $('telemetryBox').textContent = '';
          try {
            await startAndStream('/refactor/start', { legacyCode: code, targetFramework: 'FastAPI' },
              (log) => addLog($('timelineBox'), log),
              (data) => {
                $('finalCodeBox').textContent = data.generatedCode;
                $('verdictBox').innerHTML = (data.finalVerdicts || []).map(v =>
                  '<div class="verdict ' + (v.approved ? 'ok' : 'ko') + '">' + (v.approved ? '✅ ' : '❌ ') + v.reviewer + ' <small>[' + v.severity + ']</small></div>').join('');
                $('telemetryBox').textContent = 'Attempts: ' + data.attempts + ' · Qwen calls: ' + data.usage.calls +
                  ' · Tokens in/out: ' + data.usage.inputTokens + '/' + data.usage.outputTokens +
                  ' · Wall clock: ' + (data.durationMs / 1000).toFixed(1) + 's · QA approved: ' + (data.approved ? 'yes' : 'no');
                $('loading').style.display = 'none';
                $('runBtn').disabled = $('benchBtn').disabled = false;
              });
          } catch (err) {
            alert('Request failed: ' + err.message);
            $('loading').style.display = 'none';
            $('runBtn').disabled = $('benchBtn').disabled = false;
          }
        });

        $('benchBtn').addEventListener('click', async () => {
          const code = $('codeInput').value;
          if (!code.trim()) return alert('Please enter some code.');
          $('runBtn').disabled = $('benchBtn').disabled = true;
          $('loading').style.display = 'block';
          $('results').style.display = 'block';
          $('benchResults').style.display = 'none';
          $('timelineBox').innerHTML = ''; $('verdictBox').innerHTML = '';
          $('finalCodeBox').textContent = ''; $('telemetryBox').textContent = '';
          try {
            await startAndStream('/benchmark/start', { legacyCode: code, targetFramework: 'FastAPI' },
              (log) => addLog($('timelineBox'), log),
              (data) => {
                const rows = [
                  ['Judge score (0-10)', data.baseline.score.total, data.society.score.total],
                  ['· Security', data.baseline.score.security, data.society.score.security],
                  ['· Correctness', data.baseline.score.correctness, data.society.score.correctness],
                  ['· Architecture', data.baseline.score.architecture, data.society.score.architecture],
                  ['· Maintainability', data.baseline.score.maintainability, data.society.score.maintainability],
                  ['Qwen calls', data.baseline.usage.calls, data.society.usage.calls],
                  ['Tokens (in+out)', data.baseline.usage.inputTokens + data.baseline.usage.outputTokens, data.society.usage.inputTokens + data.society.usage.outputTokens],
                  ['Wall clock (s)', (data.baseline.durationMs/1000).toFixed(1), (data.society.durationMs/1000).toFixed(1)],
                ];
                $('benchTable').innerHTML = '<tr><th>Metric</th><th>Single-agent baseline</th><th>Agent society</th></tr>' +
                  rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="win">' + r[2] + '</td></tr>').join('');
                $('benchSummary').textContent = 'Quality gain: +' + data.delta.qualityGain + ' points (+' + data.delta.qualityGainPercent + '%) for +' +
                  data.delta.extraTokens + ' tokens and +' + data.delta.extraSeconds + 's. Baseline rationale: "' + data.baseline.score.rationale + '" — Society rationale: "' + data.society.score.rationale + '"';
                $('benchSocietyCode').textContent = data.society.code;
                $('benchBaselineCode').textContent = data.baseline.code;
                $('benchResults').style.display = 'block';
                $('loading').style.display = 'none';
                $('runBtn').disabled = $('benchBtn').disabled = false;
              });
          } catch (err) {
            alert('Request failed: ' + err.message);
            $('loading').style.display = 'none';
            $('runBtn').disabled = $('benchBtn').disabled = false;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ---------------------------------------------------------
// ROUTE 2: The Multi-Agent API
//   - POST /refactor | /invoke : synchronous JSON (back-compat)
//   - POST /refactor/start    : background run + SSE stream
// ---------------------------------------------------------
app.post(['/refactor', '/invoke'], async (req, res) => {
  try {
    const { legacyCode, targetFramework } = req.body;
    const codeToRefactor = legacyCode || `function add(a, b) { return a + b; }`;
    const framework = targetFramework || 'FastAPI';

    console.log('🚀 Triggering RefactorBot via API...');
    const result = await runRefactorBot(codeToRefactor, framework);

    res.json({
      success: true,
      message: 'RefactorBot execution complete!',
      approved: result.approved,
      attempts: result.attempts,
      timeline: result.logs,
      generatedCode: result.generatedCode,
      verdicts: result.finalVerdicts,
      usage: result.usage,
      durationMs: result.durationMs,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/refactor/start', (req, res) => {
  const { legacyCode, targetFramework } = req.body;
  const state = startRun((log) =>
    runRefactorBot(legacyCode || `function add(a, b) { return a + b; }`, targetFramework || 'FastAPI', log)
  );
  res.status(202).json({ runId: state.id, streamUrl: `/run/${state.id}/events` });
});

// ---------------------------------------------------------
// ROUTE 3: Benchmark — Track 3 "measurable efficiency gain
// over single-agent baselines"
// ---------------------------------------------------------
app.post('/benchmark', async (req, res) => {
  try {
    const { legacyCode, targetFramework } = req.body;
    if (!legacyCode || !String(legacyCode).trim()) {
      return res.status(400).json({ success: false, error: 'Missing "legacyCode" in request body.' });
    }
    const report = await runBenchmark(String(legacyCode), targetFramework || 'FastAPI');
    res.json({ success: true, ...report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/benchmark/start', (req, res) => {
  const { legacyCode, targetFramework } = req.body;
  if (!legacyCode || !String(legacyCode).trim()) {
    return res.status(400).json({ error: 'Missing "legacyCode" in request body.' });
  }
  const state = startRun((log) => runBenchmark(String(legacyCode), targetFramework || 'FastAPI', log));
  res.status(202).json({ runId: state.id, streamUrl: `/run/${state.id}/events` });
});

// ---------------------------------------------------------
// ROUTE 4: NIS2 Incident Response Dashboard (live SSE)
// ---------------------------------------------------------
app.get('/nis2', (_req, res) => {
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
        .telemetry { color: #94a3b8; font-size: .85rem; margin-top: .6rem; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
      </style>
    </head>
    <body>
      <h1>🛡️ NIS2 Agent Society</h1>
      <p style="color: #94a3b8; margin-bottom: 2rem;">Autonomous incident response & NIS2 reporting powered by Qwen Cloud. <a href="/" style="color:#34d399;">← RefactorBot</a></p>

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
        <div id="loading">Agent society investigating… follow the live timeline below.</div>
      </div>

      <div id="results">
        <h2>Response Timeline</h2>
        <div class="glass-panel" id="timelineBox"></div>
        <h2>NIS2 Report</h2>
        <pre><code id="reportBox"></code></pre>
        <div class="telemetry" id="telemetryBox"></div>
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
          results.style.display = 'block';
          timelineBox.innerHTML = '';
          reportBox.textContent = '';
          document.getElementById('telemetryBox').textContent = '';
          Object.values(AGENT_STEPS).forEach(id => document.getElementById(id).classList.remove('done'));

          try {
            const res = await fetch('/incident/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ incident })
            });
            const { runId } = await res.json();
            const es = new EventSource('/run/' + runId + '/events');
            es.onmessage = (msg) => {
              const { type, data } = JSON.parse(msg.data);
              if (type === 'log') {
                const stepId = AGENT_STEPS[data.agent];
                if (stepId) document.getElementById(stepId).classList.add('done');
                const div = document.createElement('div');
                div.className = 'timeline-item';
                const badge = document.createElement('div');
                badge.className = 'agent-badge';
                badge.textContent = data.agent;
                const ts = document.createElement('span');
                ts.className = 'timestamp';
                ts.textContent = '[' + data.timestamp + ']';
                const action = document.createElement('div');
                action.style.marginTop = '0.25rem';
                action.textContent = data.action;
                div.append(badge, ts, action);
                timelineBox.appendChild(div);
                div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
              if (type === 'done') {
                es.close();
                reportBox.textContent = data.report;
                document.getElementById('telemetryBox').textContent =
                  'Qwen calls: ' + data.usage.calls + ' · Tokens in/out: ' + data.usage.inputTokens + '/' + data.usage.outputTokens +
                  ' · Wall clock: ' + (data.durationMs / 1000).toFixed(1) + 's';
                loading.style.display = 'none';
                btn.disabled = false;
              }
              if (type === 'error') {
                es.close();
                alert('Pipeline error: ' + data);
                loading.style.display = 'none';
                btn.disabled = false;
              }
            };
          } catch (err) {
            alert('Request failed: ' + err.message);
            loading.style.display = 'none';
            btn.disabled = false;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ---------------------------------------------------------
// ROUTE 5: NIS2 Incident Response API
//   - POST /incident       : synchronous JSON (back-compat)
//   - POST /incident/start : background run + SSE stream
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
      report: result.report,
      usage: result.usage,
      durationMs: result.durationMs,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/incident/start', (req, res) => {
  const { incident } = req.body;
  if (!incident || !String(incident).trim()) {
    return res.status(400).json({ error: 'Missing "incident" description in request body.' });
  }
  const state = startRun((log) => runIncidentResponse(String(incident), log));
  res.status(202).json({ runId: state.id, streamUrl: `/run/${state.id}/events` });
});

// ---------------------------------------------------------
// SERVER INITIALIZATION
// ---------------------------------------------------------
const PORT = Number(process.env.PORT) || 9000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
