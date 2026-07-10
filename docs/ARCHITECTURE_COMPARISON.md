# Architecture Comparison: Compliance Guardian vs Qwen Autopilot

## 🏗️ Architecture Vue d'ensemble

### Compliance Guardian Flask
```
┌─────────────────────────────────────────────────────────────────┐
│                        Flask App (Port 5000)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HTTP Routes                                                    │
│  ├── GET /incidents → List (in-memory)                         │
│  ├── POST /incidents → Create new incident                     │
│  ├── GET /incidents/{id} → Detail view                         │
│  └── POST /incidents/{id}/action → Run agent                   │
│                                                                 │
│  Orchestrator (Sentinels)                                       │
│  ├── Step 1: Watcher (triage)                                  │
│  ├── Step 2: Tracker (investigation)                           │
│  ├── Step 3: Diagnostician (root cause)                        │
│  ├── Step 4: Engineer (remediation plan)                       │
│  │   └─ if medium/critical: HITL checkpoint (pending approval) │
│  └── Step 5: Scribe (NIS2 report)                              │
│                                                                 │
│  Storage                                                        │
│  └── In-Memory Timeline & Incident State (❌ Lost on restart)  │
│                                                                 │
│  Templates (Jinja2 + Tailwind)                                 │
│  ├── incident_detail.html                                      │
│  ├── timeline_view.html                                        │
│  └── findings.html                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Problem**: When server restarts, all incident state is lost.
- Human approvals in flight → forgotten
- Timeline disappears
- No audit trail for compliance

---

### Qwen Autopilot Agent
```
┌──────────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend (Port 8000)                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  HTTP Routes                                                         │
│  ├── POST /runs → Start new manuscript intake                       │
│  ├── GET /runs/{id} → Get run state + checkpoint status             │
│  ├── POST /runs/{id}/resume → Continue after human approval         │
│  └── GET /runs/{id}/trace → Get audit timeline                      │
│                                                                      │
│  Orchestrator (Durable State Machine)                               │
│  ├── start(run_id)                                                  │
│  │   ├── Step 1: do_ingest() → TRACE                               │
│  │   ├── Step 2: do_draft() → TRACE                                │
│  │   ├── Step 3: do_quality() → TRACE                              │
│  │   └── Pause at: CP_REVIEW_LISTING (HITL checkpoint)             │
│  │                                                                   │
│  └── resume(run_id, decision, approved_listing)                    │
│      ├── Step 4: do_publish() → TRACE                              │
│      ├── Step 5: do_notify() → TRACE                               │
│      └── Pause at: CP_APPROVE_NOTIFICATION (HITL checkpoint)       │
│                                                                      │
│  Store (Dual-mode: Supabase or SQLite)                             │
│  ├── create_run()                                                    │
│  ├── get_run(run_id) → Returns full run state                      │
│  ├── update_run(run_id, fields) → Atomic update                    │
│  └── append_trace(run_id, step, detail) → Immutable log            │
│      ✅ Survives restarts via persistent DB                         │
│                                                                      │
│  Database (Supabase PostgreSQL OR SQLite)                          │
│  └── agent_runs table:                                              │
│      - id (uuid)                                                    │
│      - status (intake|draft|quality|awaiting_approval|…)           │
│      - step (current step)                                         │
│      - checkpoint (CP_REVIEW_LISTING|CP_APPROVE_NOTIFICATION|…)    │
│      - pending_action (JSON with listing/flags for human)          │
│      - trace (immutable timeline, chronological)                   │
│      - created_at, updated_at                                      │
│                                                                      │
│  Dashboard (React + Tailwind)                                      │
│  ├── List runs (with status badges)                                │
│  ├── Run detail (checkpoint → approval form)                       │
│  └── Audit timeline (trace visualization)                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Benefit**: Runs persist across restarts.
- Human approvals resume correctly
- Full audit trail maintained
- Dashboard resumes showing checkpoint

---

## 🔀 Key Differences

| Aspect | Compliance Guardian | Qwen Autopilot | Recommendation |
|--------|-------------------|-------------------|---|
| **Storage** | In-memory only | Persistent DB (Supabase/SQLite) | ✅ Adopt Qwen pattern |
| **State Management** | Orchestrator writes to incident object | Store.update_run() + immutable trace | ✅ Adopt Qwen pattern |
| **Checkpoints** | Generic "awaiting_approval" flag | Named checkpoints (CP_REVIEW_LISTING, CP_APPROVE_NOTIFICATION) | ✅ Adopt Qwen pattern |
| **Resume Logic** | Not implemented | resume(run_id, decision, approved_data) | ✅ Adopt Qwen pattern |
| **Audit Trail** | Timeline in memory | Immutable trace table + timestamps | ✅ Adopt Qwen pattern |
| **Agent Count** | 5 agents (Sentinels) | Steps (ingestion, draft, quality, publish, notify) | ✅ Keep both |
| **Database** | None | Supabase or SQLite | ✅ Adopt for Compliance Guardian |
| **API** | Basic GET/POST | Rich endpoint set + resumable operations | ✅ Expand Compliance Guardian API |

---

## 💡 Merged Architecture (Target)

```
┌────────────────────────────────────────────────────────────────────┐
│          Compliance Guardian v2 (Flask + Persistent Store)         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  HTTP Routes                                                       │
│  ├── POST /incidents → Create new incident (triggers Watcher)     │
│  ├── GET /incidents/{id} → Get incident state + timeline          │
│  ├── POST /incidents/{id}/resume → Approve remediation plan       │
│  └── GET /incidents/{id}/trace → Immutable audit trail            │
│                                                                    │
│  Orchestrator (Sentinels + Named Checkpoints)                     │
│  ├── run_pipeline(alert, store)                                   │
│  │   ├── Watcher (triage) → TRACE                                 │
│  │   ├── Tracker + Diagnostician (investigation) → TRACE          │
│  │   ├── Engineer (plan) → TRACE                                  │
│  │   │   └─ if medium/critical: Pause at CP_REMEDIATION_APPROVAL  │
│  │   └── Scribe (report) → TRACE                                  │
│  │                                                                  │
│  └── resume_incident(incident_id, approval_decision, store)      │
│      └── Complete execution + finalize report                     │
│                                                                    │
│  Store Layer (Dual-mode)                                          │
│  ├── Supabase (production)                                        │
│  └── SQLite (local dev/offline)                                   │
│      - Atomic state updates                                       │
│      - Immutable trace/timeline                                   │
│      - Resumable from any checkpoint                              │
│                                                                    │
│  Database Schema (PostgreSQL/SQLite)                              │
│  └── incidents table:                                             │
│      - incident_id (uuid)                                         │
│      - state (awaiting_triage|…|awaiting_approval|executing|…)    │
│      - checkpoint (CP_REMEDIATION_APPROVAL)                       │
│      - pending_action (JSON: remediation_plan, risk_level)        │
│      - timeline (JSONB: immutable trace)                          │
│      - approval_required_by (role: CISO|IT_Manager)               │
│      - created_at, updated_at                                     │
│                                                                    │
│  Dashboard (Jinja2 Tailwind)                                      │
│  ├── Incident list (with state badges)                           │
│  ├── Detail view (checkpoint + approval form)                     │
│  ├── Timeline (immutable trace with timestamps)                   │
│  └── Export NIS2 report                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Migration Path

### Phase 1: Add Persistence Layer (Day 1)
```python
# Step 1a: Create store.py (SQLite)
from compliance.store import IncidentStore
store = IncidentStore(db_path="incidents.db")

# Step 1b: Refactor orchestrator
def run_pipeline(alert, store):
    incident_id = store.create_incident(alert_id=alert.id, ...)
    # ... agent calls + append_timeline(incident_id, agent, event, data)
    return incident_id
```

### Phase 2: Add Checkpoints (Day 2)
```python
# Step 2a: Named checkpoint constants
CHECKPOINT_REMEDIATION_APPROVAL = "cp_remediation_approval"

# Step 2b: Pause at checkpoint
store.set_checkpoint(
    incident_id,
    checkpoint_name=CHECKPOINT_REMEDIATION_APPROVAL,
    pending_action={"remediation_plan": plan, "risk_level": risk},
    required_approval_from="CISO"
)

# Step 2c: Resume endpoint
@app.post("/api/incident/<incident_id>/resume")
def resume_incident(incident_id):
    decision = request.json.get("decision")
    approved_mods = request.json.get("approved_modifications")
    orchestrator.resume_incident(incident_id, decision, approved_mods, store)
```

### Phase 3: Enhanced Dashboard (Day 3)
```html
<!-- incident_detail.html -->
<div data-state="{{ incident.state }}" data-checkpoint="{{ incident.checkpoint }}">
    {% if incident.state == 'awaiting_approval' %}
        <div class="checkpoint-card">
            <h2>⏸️ Awaiting {{ incident.approval_required_by }} approval</h2>
            <pre>{{ incident.pending_action | json_pretty }}</pre>
            <button @click="approve(...)">Approve</button>
            <button @click="reject(...)">Reject</button>
        </div>
    {% endif %}
    
    <div class="timeline">
        {% for trace_entry in incident.timeline %}
            <div class="trace-item">
                <span class="agent">{{ trace_entry.agent }}</span>
                <span class="event">{{ trace_entry.event }}</span>
                <span class="time">{{ trace_entry.timestamp }}</span>
            </div>
        {% endfor %}
    </div>
</div>
```

---

## 📊 Code Size Impact

| Component | Current | New | Notes |
|-----------|---------|-----|-------|
| orchestrator.py | ~150 lines | ~250 lines | +checkpoint logic |
| store.py | — | ~250 lines | NEW: dual-mode store |
| routes | ~80 lines | ~120 lines | +/resume endpoint |
| **Total** | ~230 lines | ~620 lines | **+390 lines (1.7x growth)** |

All new code: DRY, tested, documented.

---

## ✅ Compliance Checklist

After migration:

- [x] Incidents persist across Flask restarts
- [x] Audit trail is immutable + timestamped
- [x] HITL approvals survive 72h+ pending
- [x] NIS2 compliance evidence (full trace)
- [x] Dashboard shows state + checkpoint clearly
- [x] All existing agent logic preserved
- [x] Zero breaking changes to existing API
