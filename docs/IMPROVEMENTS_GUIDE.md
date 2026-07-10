# Amélioration de Compliance Guardian Flask
## Pattern Analysis : Qwen Autopilot Agent + Compliance Guardian

---

## 📊 Résumé de l'analyse

### Compliance Guardian (Flask)
✅ **Forces**
- 5 agents spécialisés (Watcher, Tracker, Diagnostician, Engineer, Scribe)
- Dashboard glassmorphism moderne
- Support multi-formats (PDF, DOCX, TXT, Markdown)
- Approche "sans build" (pas de Node/npm)

❌ **Limitations**
- État d'incident en mémoire (lost on restart)
- Pas de checkpoint nommé résilient
- Timeline d'événements non persistée
- Pas de support Supabase (stockage centralisé)
- Point d'approbation humaine basique

### Qwen Autopilot Agent (Python/FastAPI)
✅ **Forces**
- **État machine résilient** avec checkpoints nommés
- **Persistance dual-mode** : Supabase + fallback mémoire
- **Trace d'audit** complet (chaque step logué)
- **Resumable HITL** : pause → human approval → resume → continue
- **Steps déterministes** (orchestrator.py)

---

## 🎯 Améliorations à implémenter (par priorité)

### 1️⃣ CRITIQUE : Persistance d'état résiliente
**Gain** : Incidents survivent aux redémarrages, human checkpoints durables

**Implémentation**
```python
# compliance/store.py (nouveau)
from datetime import datetime
from typing import Any, Optional, Dict
import json
from pathlib import Path

class IncidentStore:
    """Dual-mode store: Supabase ou fallback file-based SQLite."""
    
    STATES = {
        "awaiting_triage": "initial state",
        "under_investigation": "running tracker + diagnostician",
        "awaiting_approval": "human checkpoint for remediation",
        "executing": "running engineer steps",
        "done": "incident resolved",
        "rejected": "human rejected remediation plan"
    }
    
    def __init__(self, supabase_client=None, db_path="incidents.db"):
        self.supabase = supabase_client
        self.db_path = db_path
        if not supabase_client:
            # fallback: SQLite local store
            self._init_sqlite()
    
    def create_incident(self, alert_id: str, incident_data: Dict) -> Dict:
        """Create incident record with initial state."""
        doc = {
            "incident_id": incident_id,
            "alert_id": alert_id,
            "state": "awaiting_triage",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "timeline": [],  # Event log
            "checkpoint": None,  # Current HITL checkpoint
            "approval_required_by": None,  # Role needed to approve
            **incident_data
        }
        if self.supabase:
            return self.supabase.table("incidents").insert(doc).execute().data[0]
        # Fallback: SQLite insert
        return self._sqlite_insert("incidents", doc)
    
    def append_timeline(self, incident_id: str, agent: str, event: str, data: Dict):
        """Append immutable timeline event."""
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "agent": agent,
            "event": event,
            "data": data
        }
        if self.supabase:
            incident = self.supabase.table("incidents")\
                .select("timeline").eq("incident_id", incident_id).execute().data[0]
            timeline = incident.get("timeline", []) + [entry]
            self.supabase.table("incidents")\
                .update({"timeline": timeline})\
                .eq("incident_id", incident_id).execute()
        else:
            self._sqlite_append("incidents", incident_id, "timeline", entry)
    
    def set_checkpoint(self, incident_id: str, checkpoint_name: str, 
                      pending_action: Dict, required_approval_from: str):
        """Pause pipeline at human-required checkpoint."""
        if self.supabase:
            self.supabase.table("incidents").update({
                "state": "awaiting_approval",
                "checkpoint": checkpoint_name,
                "pending_action": pending_action,
                "approval_required_by": required_approval_from
            }).eq("incident_id", incident_id).execute()
        else:
            self._sqlite_update("incidents", incident_id, {
                "state": "awaiting_approval",
                "checkpoint": checkpoint_name,
                "pending_action": pending_action,
                "approval_required_by": required_approval_from
            })
    
    def resume_from_checkpoint(self, incident_id: str, approval_decision: str,
                              approved_data: Dict = None) -> Dict:
        """Resume after human approval/rejection."""
        if self.supabase:
            update = {
                "state": "executing" if approval_decision == "approved" else "rejected",
                "checkpoint": None,
                "approval_decision": approval_decision,
                "approved_at": datetime.utcnow().isoformat()
            }
            if approved_data:
                update["approved_modifications"] = approved_data
            return self.supabase.table("incidents")\
                .update(update).eq("incident_id", incident_id).execute().data[0]
        # Fallback: SQLite
        return self._sqlite_update("incidents", incident_id, {
            "state": "executing" if approval_decision == "approved" else "rejected",
            "checkpoint": None,
            "approval_decision": approval_decision
        })
```

**Schéma DB minimal** :
```sql
CREATE TABLE incidents (
    incident_id TEXT PRIMARY KEY,
    alert_id TEXT,
    state TEXT CHECK(state IN ('awaiting_triage', 'under_investigation', 'awaiting_approval', 'executing', 'done', 'rejected')),
    created_at TEXT,
    updated_at TEXT,
    checkpoint TEXT,
    pending_action JSONB,
    approval_required_by TEXT,
    timeline JSONB,
    classification JSONB,
    investigation JSONB,
    root_cause TEXT,
    remediation_plan JSONB,
    approved_modifications JSONB
);
```

---

### 2️⃣ IMPORTANT : État machine avec checkpoints nommés
**Gain** : HITL checkpoints survivent aux redémarrages, dashboard peut afficher "Pending approval from CISO"

**Implémentation**
```python
# compliance/sentinels/orchestrator.py (refactored)

CHECKPOINT_TRIAGE = "cp_triage_complete"
CHECKPOINT_INVESTIGATION = "cp_investigation_complete"
CHECKPOINT_APPROVAL = "cp_remediation_approval"

def run_pipeline(alert: Alert, store: IncidentStore) -> str:
    """Returns incident_id for tracking and HITL resume."""
    incident_id = store.create_incident(
        alert_id=alert.id,
        incident_data={"service": alert.service, "severity": alert.severity}
    )
    
    try:
        # Step 1: Watcher (always completes, no HITL needed)
        log.info(f"{incident_id}: Step 1/5 — The Watcher")
        classification = run_watcher(alert)
        store.append_timeline(incident_id, "Watcher", "classification_complete", classification)
        
        # Step 2-3: Tracker & Diagnostician
        log.info(f"{incident_id}: Step 2-3 — Investigation")
        investigation, root_cause = run_tracker_diagnostician(alert, classification)
        store.append_timeline(incident_id, "Tracker+Diagnostician", "investigation_complete", 
                            {"root_cause": root_cause})
        
        # Step 4: Engineer — may require approval
        log.info(f"{incident_id}: Step 4/5 — The Engineer (plan generation)")
        plan, risk, requires_approval = run_engineer(alert, root_cause)
        
        if requires_approval:
            # HITL CHECKPOINT: requires_approval for medium/critical risk
            approval_role = "CISO" if risk == "critical" else "IT Manager"
            store.set_checkpoint(
                incident_id,
                checkpoint_name=CHECKPOINT_APPROVAL,
                pending_action={
                    "remediation_plan": plan,
                    "risk_level": risk
                },
                required_approval_from=approval_role
            )
            store.append_timeline(incident_id, "Orchestrator", "checkpoint_set",
                                {"checkpoint": CHECKPOINT_APPROVAL, "required_from": approval_role})
            # Return incident_id; dashboard shows "Awaiting approval from CISO"
            return incident_id
        
        # Auto-approved (low risk): proceed to execution
        store.append_timeline(incident_id, "Orchestrator", "auto_approved", 
                            {"reason": "low risk"})
        
        # Step 5: Scribe (post-incident report)
        report = run_scribe(alert, root_cause, plan)
        store.append_timeline(incident_id, "Scribe", "report_generated", 
                            {"report_url": report.get("url")})
        
        # Mark complete
        store.update_incident_state(incident_id, "done")
        return incident_id
        
    except Exception as e:
        store.append_timeline(incident_id, "Orchestrator", "error", 
                            {"error": str(e)})
        store.update_incident_state(incident_id, "failed")
        raise

def resume_incident(incident_id: str, approval_decision: str, 
                   approved_modifications: Dict = None, store: IncidentStore = None):
    """Resume from CHECKPOINT_APPROVAL after human decision."""
    incident = store.get_incident(incident_id)
    
    if approval_decision == "rejected":
        store.append_timeline(incident_id, "Human", "remediation_rejected", 
                            {"reason": approved_modifications.get("rejection_reason")})
        store.update_incident_state(incident_id, "rejected")
        return
    
    if approval_decision != "approved":
        raise ValueError(f"invalid decision: {approval_decision}")
    
    # Human approved (possibly with modifications)
    plan = approved_modifications or incident.get("pending_action", {}).get("remediation_plan", {})
    
    try:
        log.info(f"{incident_id}: Executing approved remediation plan")
        # Step 5: Engineer execution
        run_engineer_execution(incident_id, plan)
        store.append_timeline(incident_id, "Orchestrator", "remediation_executed", 
                            {"plan_id": plan.get("id")})
        
        # Step 6: Scribe (post-incident report)
        report = run_scribe(incident_id, approved_modifications=plan)
        store.append_timeline(incident_id, "Scribe", "final_report_generated", 
                            {"report_url": report.get("url")})
        
        store.update_incident_state(incident_id, "done")
        
    except Exception as e:
        store.append_timeline(incident_id, "Orchestrator", "execution_error", 
                            {"error": str(e)})
        store.update_incident_state(incident_id, "execution_failed")
        raise
```

---

### 3️⃣ FEATURE : Timeline immutable audit trail
**Gain** : Compliance audit trail (qui a fait quoi, quand, pourquoi)

**Implémentation** : Voir `append_timeline()` ci-dessus.
- Chaque agent log ses étapes dans la timeline
- Timestamps UTC immuables
- Preuve d'exécution pour l'audit NIS2

---

### 4️⃣ UI/UX : Dashboard amélioré avec état d'incident
**Gain** : Users voient l'état exact ("Awaiting CISO approval since 14h ago")

**Template Jinja2 nouvelle** :
```html
<!-- templates/incident_dashboard.html -->
<div class="incident-card" data-state="{{ incident.state }}">
    <div class="state-badge {{ incident.state }}">
        {% if incident.state == 'awaiting_approval' %}
            ⏸️ Awaiting approval from {{ incident.approval_required_by }}
            <span class="since">{{ time_since(incident.checkpoint_set_at) }}</span>
        {% elif incident.state == 'executing' %}
            ⚙️ Executing remediation plan...
        {% elif incident.state == 'done' %}
            ✅ Resolved
        {% elif incident.state == 'rejected' %}
            ❌ Rejected
        {% endif %}
    </div>
    
    <div class="timeline">
        {% for event in incident.timeline %}
            <div class="timeline-entry agent-{{ event.agent }}">
                <span class="time">{{ event.timestamp | time_format }}</span>
                <span class="agent-name">{{ event.agent }}</span>
                <span class="event">{{ event.event }}</span>
                <details>
                    <summary>Details</summary>
                    <pre>{{ event.data | json_pretty }}</pre>
                </details>
            </div>
        {% endfor %}
    </div>
    
    {% if incident.checkpoint %}
        <div class="pending-action">
            <h3>Pending Human Action</h3>
            <p>{{ incident.checkpoint | human_readable }}</p>
            <div class="action-buttons">
                <button @click="approve(incident.id)">Approve</button>
                <button @click="reject(incident.id)">Reject</button>
            </div>
        </div>
    {% endif %}
</div>
```

---

### 5️⃣ API : Endpoints pour HITL resume
**Gain** : Frontend peut afficher "Approve" button et POST à `/api/incident/{id}/approve`

**Implémentation** :
```python
# compliance/api.py (nouvelle)

@app.post("/api/incident/<incident_id>/approve")
@require_auth("it_manager", "ciso")  # Role-based auth
def approve_incident(incident_id: str):
    """Human approves remediation plan (optionally with modifications)."""
    data = request.get_json()
    decision = data.get("decision")  # "approved" | "rejected"
    approved_modifications = data.get("modifications", {})
    
    try:
        store.resume_from_checkpoint(
            incident_id,
            approval_decision=decision,
            approved_data=approved_modifications
        )
        # Start async execution
        background_task.enqueue(orchestrator.resume_incident, incident_id, decision)
        return {"status": "resumed", "incident_id": incident_id}
    except ValueError as e:
        return {"error": str(e)}, 400

@app.get("/api/incident/<incident_id>")
def get_incident(incident_id: str):
    """Get incident state for dashboard."""
    incident = store.get_incident(incident_id)
    if not incident:
        return {"error": "not found"}, 404
    return incident
```

---

## 📈 Métriques d'amélioration

| Aspect | Avant | Après |
|--------|-------|-------|
| **Résilience** | En mémoire (perte à redémarrage) | Persisté (survit redémarrage) |
| **HITL Durabilité** | Pas de checkpoint nommé | Checkpoints durables + resumable |
| **Audit Trail** | Timeline en mémoire | Timeline immutable + timestamped |
| **Compliance** | Pas de preuve d'exécution | Trace complet + audit-ready |
| **UX** | "Incident running..." | "Awaiting CISO approval (14h pending)" |

---

## 🛠️ Plan d'implémentation (3 phases)

### Phase 1 (Jour 1) : Store + Persistance
- [ ] Implémenter `compliance/store.py` (SQLite fallback)
- [ ] Refactoriser orchestrator pour utiliser store
- [ ] Tests: incidents survivent redémarrage

### Phase 2 (Jour 2) : Checkpoints + HITL
- [ ] Ajouter checkpoint logic à orchestrator
- [ ] API endpoints `/api/incident/{id}/approve`
- [ ] Tests: HITL pause/resume

### Phase 3 (Jour 3) : Dashboard + UX
- [ ] Template `incident_dashboard.html`
- [ ] Timeline UI amélioré
- [ ] Tests E2E

---

## 🔗 Références code

### Qwen Autopilot Patterns utilisés
1. **store.py** : Dual-mode Supabase/SQLite
2. **orchestrator.py** : State machine + checkpoints nommés
3. **steps.py** : Séquence déterministe (intake → draft → quality → HITL)
4. **trace** : Audit immutable

### Compliance Guardian Assets à préserver
1. **5 agents sentinels** (Watcher, Tracker, Diagnostician, Engineer, Scribe)
2. **Qwen integration** (qwen_client.py)
3. **Dashboard UI** (templates glassmorphism)
4. **NIS2 compliance** (report generation)

---

## ✅ Success Criteria

- [ ] Incident state persists across server restarts
- [ ] HITL checkpoints are durable (survive 72h+ pending)
- [ ] Timeline audit trail is immutable + timestamped
- [ ] Dashboard shows "Awaiting [Role] approval since [time]"
- [ ] Resume API works end-to-end
- [ ] All existing tests pass
- [ ] New store tests have 90%+ coverage
