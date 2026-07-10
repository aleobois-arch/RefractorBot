# Implementation Snippets: Ready-to-Use Code

Quick copy-paste snippets to accelerate implementation of the improved Compliance Guardian.

---

## 1️⃣ Store Layer (compliance/store.py)

### Option A: SQLite-based (for local dev + offline)

```python
# compliance/store.py
"""Incident storage with dual-mode support: Supabase or SQLite."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

class IncidentStore:
    """Persistent incident store with fallback to SQLite."""
    
    DB_PATH = Path("incidents.db")
    
    def __init__(self, use_supabase: bool = False, supabase_client=None):
        self.use_supabase = use_supabase and supabase_client is not None
        self.supabase = supabase_client
        if not self.use_supabase:
            self._init_sqlite()
    
    def _init_sqlite(self):
        """Initialize SQLite schema."""
        conn = sqlite3.connect(self.DB_PATH)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                incident_id TEXT PRIMARY KEY,
                alert_id TEXT,
                state TEXT NOT NULL,
                checkpoint TEXT,
                pending_action TEXT,
                approval_required_by TEXT,
                classification TEXT,
                investigation TEXT,
                root_cause TEXT,
                remediation_plan TEXT,
                timeline TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()
    
    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()
    
    def create_incident(self, alert_id: str, **kwargs) -> Dict[str, Any]:
        """Create new incident record."""
        incident_id = f"INC-{uuid.uuid4().hex[:12].upper()}"
        doc = {
            "incident_id": incident_id,
            "alert_id": alert_id,
            "state": "awaiting_triage",
            "checkpoint": None,
            "pending_action": None,
            "approval_required_by": None,
            "timeline": [],
            "created_at": self._now(),
            "updated_at": self._now(),
            **kwargs
        }
        
        if self.use_supabase:
            result = self.supabase.table("incidents").insert(doc).execute()
            return result.data[0]
        
        conn = sqlite3.connect(self.DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO incidents 
            (incident_id, alert_id, state, timeline, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (incident_id, alert_id, doc["state"], json.dumps(doc["timeline"]), 
              doc["created_at"], doc["updated_at"]))
        
        for key in ["checkpoint", "pending_action", "approval_required_by", 
                    "classification", "investigation", "root_cause", "remediation_plan"]:
            if key in doc:
                cursor.execute(f"UPDATE incidents SET {key}=? WHERE incident_id=?",
                             (json.dumps(doc[key]) if isinstance(doc[key], dict) else doc[key], 
                              incident_id))
        
        conn.commit()
        conn.close()
        return doc
    
    def get_incident(self, incident_id: str) -> Optional[Dict[str, Any]]:
        """Get incident by ID."""
        if self.use_supabase:
            result = self.supabase.table("incidents").select("*").eq("incident_id", incident_id).execute()
            return result.data[0] if result.data else None
        
        conn = sqlite3.connect(self.DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM incidents WHERE incident_id = ?", (incident_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        doc = dict(row)
        for key in ["pending_action", "classification", "investigation", 
                    "remediation_plan", "timeline"]:
            if doc.get(key):
                doc[key] = json.loads(doc[key])
        return doc
    
    def update_incident_state(self, incident_id: str, **fields) -> Optional[Dict[str, Any]]:
        """Update incident fields (atomically)."""
        fields["updated_at"] = self._now()
        
        if self.use_supabase:
            result = self.supabase.table("incidents").update(fields).eq("incident_id", incident_id).execute()
            return result.data[0] if result.data else None
        
        conn = sqlite3.connect(self.DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        set_clause = ", ".join([f"{k}=?" for k in fields.keys()])
        values = [json.dumps(v) if isinstance(v, dict) else v for v in fields.values()]
        values.append(incident_id)
        
        cursor.execute(f"UPDATE incidents SET {set_clause} WHERE incident_id=?", values)
        
        cursor.execute("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
        row = cursor.fetchone()
        conn.commit()
        conn.close()
        
        if not row:
            return None
        
        return dict(row)
    
    def append_timeline(self, incident_id: str, agent: str, event: str, data: Dict = None) -> None:
        """Append immutable event to timeline."""
        entry = {
            "timestamp": self._now(),
            "agent": agent,
            "event": event,
            "data": data or {}
        }
        
        incident = self.get_incident(incident_id)
        if not incident:
            return
        
        timeline = incident.get("timeline", [])
        if not isinstance(timeline, list):
            timeline = []
        
        timeline.append(entry)
        
        if self.use_supabase:
            self.supabase.table("incidents").update({"timeline": timeline}).eq("incident_id", incident_id).execute()
        else:
            conn = sqlite3.connect(self.DB_PATH)
            cursor = conn.cursor()
            cursor.execute("UPDATE incidents SET timeline=?, updated_at=? WHERE incident_id=?",
                         (json.dumps(timeline), self._now(), incident_id))
            conn.commit()
            conn.close()
    
    def set_checkpoint(self, incident_id: str, checkpoint_name: str, 
                      pending_action: Dict, required_approval_from: str) -> None:
        """Pause at checkpoint, waiting for human approval."""
        self.update_incident_state(
            incident_id,
            state="awaiting_approval",
            checkpoint=checkpoint_name,
            pending_action=pending_action,
            approval_required_by=required_approval_from
        )
    
    def list_incidents(self, limit: int = 50) -> List[Dict[str, Any]]:
        """List all incidents, newest first."""
        if self.use_supabase:
            result = self.supabase.table("incidents").select("*").order("created_at", desc=True).limit(limit).execute()
            return result.data or []
        
        conn = sqlite3.connect(self.DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        conn.close()
        
        incidents = []
        for row in rows:
            doc = dict(row)
            for key in ["pending_action", "classification", "investigation", 
                        "remediation_plan", "timeline"]:
                if doc.get(key):
                    doc[key] = json.loads(doc[key])
            incidents.append(doc)
        return incidents
```

---

## 2️⃣ Orchestrator Checkpoint Logic

### Updated run_pipeline() with store integration

```python
# compliance/sentinels/orchestrator.py (updated excerpt)

from .store import IncidentStore

# Checkpoint constants
CHECKPOINT_REMEDIATION_APPROVAL = "cp_remediation_approval"

def run_pipeline(alert: Alert, store: IncidentStore) -> str:
    """
    Run full five-agent pipeline.
    Returns incident_id for tracking and HITL resume.
    """
    # Create incident record
    incident_id = store.create_incident(
        alert_id=alert.id,
        service=alert.service,
        severity=alert.severity
    )
    
    log.info(f"[{incident_id}] Incident opened for {alert.service}")
    store.append_timeline(incident_id, "Orchestrator", "incident_opened", 
                         {"alert_id": alert.id, "service": alert.service})
    
    try:
        # Step 1/5: The Watcher (always auto-completes)
        log.info(f"[{incident_id}] Step 1/5 — The Watcher")
        classification = run_watcher(alert)
        store.append_timeline(incident_id, "Watcher", "classification_complete",
                            {"severity": classification.get("severity"),
                             "category": classification.get("category"),
                             "nis2_relevant": classification.get("nis2_relevant")})
        
        # Step 2/5: The Tracker (read-only investigation)
        log.info(f"[{incident_id}] Step 2/5 — The Tracker")
        investigation = run_tracker(alert, classification)
        store.append_timeline(incident_id, "Tracker", "investigation_complete",
                            {"timeline_events": len(investigation.get("timeline", [])),
                             "affected_assets": investigation.get("affected_assets", [])})
        
        # Step 3/5: The Diagnostician
        log.info(f"[{incident_id}] Step 3/5 — The Diagnostician")
        root_cause, confidence = run_diagnostician(alert, investigation)
        store.append_timeline(incident_id, "Diagnostician", "diagnosis_complete",
                            {"root_cause": root_cause, "confidence": confidence})
        
        # Step 4/5: The Engineer (may require approval)
        log.info(f"[{incident_id}] Step 4/5 — The Engineer")
        remediation_plan, risk_level, requires_approval = run_engineer(
            alert, root_cause, confidence
        )
        
        if requires_approval:
            # HUMAN CHECKPOINT: Medium or Critical risk requires approval
            approval_role = "CISO" if risk_level == "critical" else "IT Manager"
            
            store.set_checkpoint(
                incident_id,
                checkpoint_name=CHECKPOINT_REMEDIATION_APPROVAL,
                pending_action={
                    "remediation_plan": remediation_plan,
                    "risk_level": risk_level,
                    "required_actions": len(remediation_plan.get("steps", []))
                },
                required_approval_from=approval_role
            )
            
            store.append_timeline(incident_id, "Orchestrator", "checkpoint_set",
                                {"checkpoint": CHECKPOINT_REMEDIATION_APPROVAL,
                                 "required_from": approval_role,
                                 "risk_level": risk_level})
            
            log.info(f"[{incident_id}] Paused at checkpoint {CHECKPOINT_REMEDIATION_APPROVAL}")
            log.info(f"[{incident_id}] Awaiting approval from {approval_role}")
            
            # Return here; dashboard shows "Awaiting CISO approval"
            return incident_id
        
        # Low risk: auto-approved, proceed to execution
        log.info(f"[{incident_id}] Auto-approved (low risk)")
        store.append_timeline(incident_id, "Orchestrator", "auto_approved",
                            {"reason": "risk_level_low"})
        
        # Continue to Step 5
        _execute_remediation_and_finalize(incident_id, alert, remediation_plan, store)
        
        return incident_id
        
    except Exception as e:
        log.error(f"[{incident_id}] Pipeline error: {str(e)}")
        store.append_timeline(incident_id, "Orchestrator", "error",
                            {"error": str(e), "error_type": type(e).__name__})
        store.update_incident_state(incident_id, state="failed")
        raise


def _execute_remediation_and_finalize(incident_id: str, alert: Alert, 
                                      remediation_plan: Dict, store: IncidentStore) -> None:
    """Execute remediation and finalize report (Step 5)."""
    log.info(f"[{incident_id}] Step 5/5 — The Scribe (post-incident report)")
    
    # TODO: Actual remediation execution here
    # For now, just mark as executing
    store.update_incident_state(incident_id, state="executing")
    
    report = run_scribe(alert, remediation_plan)
    store.append_timeline(incident_id, "Scribe", "report_generated",
                        {"report_type": "NIS2", "pages": len(report)})
    
    store.update_incident_state(incident_id, state="done")
    log.info(f"[{incident_id}] Incident resolved and reported")


def resume_incident(incident_id: str, approval_decision: str, 
                   approved_modifications: Dict = None, 
                   store: IncidentStore = None) -> None:
    """
    Resume incident after human approval/rejection at checkpoint.
    
    Args:
        incident_id: Incident to resume
        approval_decision: "approved" or "rejected"
        approved_modifications: Optional human edits to the remediation plan
        store: IncidentStore instance
    """
    if store is None:
        from .store import get_store
        store = get_store()
    
    incident = store.get_incident(incident_id)
    if not incident:
        raise ValueError(f"Incident {incident_id} not found")
    
    if incident.get("checkpoint") != CHECKPOINT_REMEDIATION_APPROVAL:
        raise ValueError(f"Cannot resume from checkpoint: {incident.get('checkpoint')}")
    
    if approval_decision == "rejected":
        log.info(f"[{incident_id}] Remediation plan rejected by {incident.get('approval_required_by')}")
        store.append_timeline(incident_id, "Human", "remediation_rejected",
                            {"reason": approved_modifications.get("rejection_reason", "")
                                       if approved_modifications else "No reason provided"})
        store.update_incident_state(incident_id, state="rejected", checkpoint=None)
        return
    
    if approval_decision != "approved":
        raise ValueError(f"Invalid approval_decision: {approval_decision}")
    
    # Approved: use human-modified plan if provided, else original plan
    original_plan = incident.get("pending_action", {}).get("remediation_plan", {})
    plan = approved_modifications or original_plan
    
    log.info(f"[{incident_id}] Remediation plan approved by {incident.get('approval_required_by')}")
    store.append_timeline(incident_id, "Human", "remediation_approved",
                        {"modifications_applied": bool(approved_modifications)})
    
    try:
        # Execute Step 5
        alert = Alert(id=incident.get("alert_id"), service=incident.get("service"))
        _execute_remediation_and_finalize(incident_id, alert, plan, store)
        
    except Exception as e:
        log.error(f"[{incident_id}] Execution error after approval: {str(e)}")
        store.append_timeline(incident_id, "Orchestrator", "execution_error",
                            {"error": str(e)})
        store.update_incident_state(incident_id, state="execution_failed")
        raise
```

---

## 3️⃣ API Endpoints for HITL Resume

### New Flask routes

```python
# compliance/routes.py (new endpoints)

from flask import Blueprint, jsonify, request
from compliance.store import IncidentStore
from compliance.sentinels.orchestrator import resume_incident, CHECKPOINT_REMEDIATION_APPROVAL

bp = Blueprint("incident_api", __name__, url_prefix="/api")
store = IncidentStore()  # Singleton or DI


@bp.post("/incidents")
def create_incident():
    """Create new incident from alert data."""
    data = request.get_json()
    alert_id = data.get("alert_id")
    service = data.get("service")
    severity = data.get("severity")
    
    if not all([alert_id, service, severity]):
        return {"error": "missing fields"}, 400
    
    try:
        from compliance.sentinels.orchestrator import run_pipeline
        from compliance.sentinels.types import Alert
        
        alert = Alert(id=alert_id, service=service, severity=severity)
        incident_id = run_pipeline(alert, store)
        
        incident = store.get_incident(incident_id)
        return jsonify(incident), 201
        
    except Exception as e:
        return {"error": str(e)}, 500


@bp.get("/incidents/<incident_id>")
def get_incident(incident_id: str):
    """Get incident state + timeline."""
    incident = store.get_incident(incident_id)
    if not incident:
        return {"error": "not found"}, 404
    return jsonify(incident)


@bp.get("/incidents")
def list_incidents():
    """List all incidents, newest first."""
    limit = request.args.get("limit", 50, type=int)
    incidents = store.list_incidents(limit=min(limit, 100))
    return jsonify(incidents)


@bp.post("/incidents/<incident_id>/approve")
def approve_incident(incident_id: str):
    """
    Human approves remediation plan at checkpoint.
    
    Request body:
    {
        "decision": "approved" or "rejected",
        "approved_modifications": {optional edit to remediation plan},
        "rejection_reason": {if rejected}
    }
    """
    incident = store.get_incident(incident_id)
    if not incident:
        return {"error": "not found"}, 404
    
    data = request.get_json()
    decision = data.get("decision")
    approved_modifications = data.get("approved_modifications")
    
    if decision not in ("approved", "rejected"):
        return {"error": "decision must be 'approved' or 'rejected'"}, 400
    
    if incident.get("state") != "awaiting_approval":
        return {"error": f"incident is in state '{incident.get('state')}', not awaiting_approval"}, 409
    
    try:
        # Run resume in background or synchronously
        resume_incident(incident_id, decision, approved_modifications, store)
        
        updated = store.get_incident(incident_id)
        return jsonify({"status": "resumed", "incident": updated})
        
    except Exception as e:
        return {"error": str(e)}, 500


@bp.get("/incidents/<incident_id>/trace")
def get_incident_trace(incident_id: str):
    """Get immutable audit trail (timeline)."""
    incident = store.get_incident(incident_id)
    if not incident:
        return {"error": "not found"}, 404
    
    return jsonify({
        "incident_id": incident_id,
        "state": incident.get("state"),
        "trace": incident.get("timeline", [])
    })


# Register blueprint in main Flask app
# app.register_blueprint(bp)
```

---

## 4️⃣ Enhanced Dashboard Template

### incident_detail.html (Jinja2)

```html
<!-- templates/incident_detail.html -->
{% extends "base.html" %}

{% block title %}Incident {{ incident.incident_id }}{% endblock %}

{% block content %}
<div class="incident-detail">
    <!-- State Badge & Metadata -->
    <div class="incident-header">
        <h1>{{ incident.incident_id }}</h1>
        
        <div class="state-badge" data-state="{{ incident.state }}">
            {% if incident.state == 'awaiting_approval' %}
                <span class="icon">⏸️</span>
                <span class="label">Awaiting approval from {{ incident.approval_required_by }}</span>
                <span class="time-badge">{{ time_since(incident.updated_at) }}</span>
            {% elif incident.state == 'executing' %}
                <span class="icon">⚙️</span>
                <span class="label">Executing remediation plan...</span>
            {% elif incident.state == 'done' %}
                <span class="icon">✅</span>
                <span class="label">Resolved</span>
            {% elif incident.state == 'rejected' %}
                <span class="icon">❌</span>
                <span class="label">Rejected by {{ incident.approval_required_by }}</span>
            {% elif incident.state == 'failed' %}
                <span class="icon">⚠️</span>
                <span class="label">Pipeline error</span>
            {% else %}
                <span class="icon">⏳</span>
                <span class="label">{{ incident.state }}</span>
            {% endif %}
        </div>
        
        <dl class="metadata">
            <dt>Alert ID:</dt> <dd>{{ incident.alert_id }}</dd>
            <dt>Service:</dt> <dd>{{ incident.service }}</dd>
            <dt>Severity:</dt> <dd><span class="severity-{{ incident.severity | lower }}">{{ incident.severity }}</span></dd>
            <dt>Created:</dt> <dd>{{ incident.created_at | format_datetime }}</dd>
        </dl>
    </div>
    
    <!-- HITL Checkpoint (if awaiting approval) -->
    {% if incident.state == 'awaiting_approval' and incident.checkpoint %}
    <div class="pending-action-section">
        <h2>⏸️ Pending Human Action</h2>
        
        <div class="checkpoint-panel">
            <h3>{{ incident.checkpoint | human_readable_checkpoint }}</h3>
            
            <div class="pending-details">
                {% if incident.checkpoint == 'cp_remediation_approval' %}
                    <div class="risk-indicator">
                        <strong>Risk Level:</strong>
                        <span class="risk-{{ incident.pending_action.risk_level | lower }}">
                            {{ incident.pending_action.risk_level | upper }}
                        </span>
                    </div>
                    
                    <div class="remediation-plan">
                        <strong>Proposed Plan:</strong>
                        <pre>{{ incident.pending_action.remediation_plan | json_pretty }}</pre>
                        <p class="note">You can edit this plan before approving.</p>
                    </div>
                {% endif %}
            </div>
            
            <!-- Approval Form -->
            <form id="approval-form" class="approval-form">
                <div class="form-group">
                    <label>Decision:</label>
                    <div class="radio-group">
                        <label>
                            <input type="radio" name="decision" value="approved" checked>
                            Approve
                        </label>
                        <label>
                            <input type="radio" name="decision" value="rejected">
                            Reject
                        </label>
                    </div>
                </div>
                
                <div id="rejection-reason-section" style="display: none;">
                    <div class="form-group">
                        <label for="rejection-reason">Rejection Reason:</label>
                        <textarea name="rejection_reason" id="rejection-reason" 
                                  placeholder="Why are you rejecting this plan?"></textarea>
                    </div>
                </div>
                
                <div id="modifications-section" style="display: none;">
                    <div class="form-group">
                        <label for="modifications">Approved Modifications (JSON):</label>
                        <textarea name="modifications" id="modifications" 
                                  placeholder='{"steps": [...]}'></textarea>
                    </div>
                </div>
                
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Submit Decision</button>
                    <button type="reset" class="btn btn-secondary">Cancel</button>
                </div>
            </form>
        </div>
    </div>
    {% endif %}
    
    <!-- Timeline / Audit Trail -->
    <div class="timeline-section">
        <h2>📋 Audit Timeline</h2>
        <div class="timeline">
            {% for entry in incident.timeline | reverse %}
            <div class="timeline-entry agent-{{ entry.agent | lower | replace(' ', '-') }}">
                <div class="timeline-marker">
                    <span class="agent-badge">{{ entry.agent }}</span>
                </div>
                <div class="timeline-content">
                    <div class="event-header">
                        <strong class="event-name">{{ entry.event }}</strong>
                        <span class="timestamp">{{ entry.timestamp | format_datetime }}</span>
                    </div>
                    {% if entry.data %}
                    <details class="event-details">
                        <summary>Details</summary>
                        <pre>{{ entry.data | json_pretty }}</pre>
                    </details>
                    {% endif %}
                </div>
            </div>
            {% endfor %}
        </div>
    </div>
    
    <!-- Export Report -->
    <div class="report-section">
        <h2>📄 Export Report</h2>
        <a href="/api/incidents/{{ incident.incident_id }}/report/pdf" class="btn btn-primary">
            Download PDF Report
        </a>
        <a href="/api/incidents/{{ incident.incident_id }}/trace" class="btn btn-secondary">
            Download Audit JSON
        </a>
    </div>
</div>

<style>
.incident-detail {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
}

.state-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 600;
    margin: 1rem 0;
}

.state-badge[data-state="awaiting_approval"] {
    background-color: #fef3c7;
    color: #92400e;
    border-left: 4px solid #f59e0b;
}

.state-badge[data-state="done"] {
    background-color: #d1fae5;
    color: #065f46;
    border-left: 4px solid #10b981;
}

.state-badge[data-state="rejected"] {
    background-color: #fee2e2;
    color: #7f1d1d;
    border-left: 4px solid #ef4444;
}

.approval-form {
    background: #f9fafb;
    padding: 1.5rem;
    border-radius: 0.5rem;
    margin-top: 1rem;
}

.timeline {
    display: flex;
    flex-direction: column-reverse;
    gap: 1.5rem;
    margin-top: 1.5rem;
}

.timeline-entry {
    display: flex;
    gap: 1rem;
}

.timeline-marker {
    flex-shrink: 0;
}

.agent-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
}

.agent-badge {
    background-color: #e5e7eb;
    color: #374151;
}

.timeline-content {
    flex-grow: 1;
    padding: 0.75rem;
    background: #f3f4f6;
    border-radius: 0.5rem;
}

.event-details {
    margin-top: 0.75rem;
    cursor: pointer;
}

.event-details pre {
    background: #1f2937;
    color: #f3f4f6;
    padding: 0.75rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
    overflow-x: auto;
}
</style>

<script>
document.getElementById('approval-form')?.addEventListener('change', (e) => {
    const decision = document.querySelector('input[name="decision"]:checked')?.value;
    document.getElementById('rejection-reason-section').style.display = 
        decision === 'rejected' ? 'block' : 'none';
    document.getElementById('modifications-section').style.display = 
        decision === 'approved' ? 'block' : 'none';
});

document.getElementById('approval-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const decision = document.querySelector('input[name="decision"]:checked')?.value;
    const reason = document.getElementById('rejection-reason')?.value;
    const mods = document.getElementById('modifications')?.value;
    
    const body = {
        decision,
        rejection_reason: reason,
        approved_modifications: mods ? JSON.parse(mods) : null
    };
    
    try {
        const res = await fetch('/api/incidents/{{ incident.incident_id }}/approve', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        if (res.ok) {
            alert('Decision submitted. Page will refresh...');
            location.reload();
        } else {
            const err = await res.json();
            alert(`Error: ${err.error}`);
        }
    } catch (err) {
        alert(`Request failed: ${err.message}`);
    }
});
</script>
{% endblock %}
```

---

## 5️⃣ Unit Test Example

### test_store.py

```python
# compliance/tests/test_store.py

import pytest
from compliance.store import IncidentStore

@pytest.fixture
def store():
    """In-memory store for testing."""
    return IncidentStore(use_supabase=False)

def test_create_incident(store):
    """Test incident creation."""
    incident = store.create_incident(
        alert_id="ALERT-123",
        service="database",
        severity="HIGH"
    )
    
    assert incident["incident_id"].startswith("INC-")
    assert incident["alert_id"] == "ALERT-123"
    assert incident["state"] == "awaiting_triage"
    assert incident["timeline"] == []

def test_append_timeline(store):
    """Test immutable timeline append."""
    incident = store.create_incident(alert_id="ALERT-123", service="database")
    incident_id = incident["incident_id"]
    
    store.append_timeline(incident_id, "Watcher", "classification_complete",
                         {"severity": "HIGH", "category": "ransomware"})
    
    incident = store.get_incident(incident_id)
    assert len(incident["timeline"]) == 1
    assert incident["timeline"][0]["agent"] == "Watcher"
    assert incident["timeline"][0]["event"] == "classification_complete"
    assert "timestamp" in incident["timeline"][0]

def test_set_checkpoint(store):
    """Test checkpoint pause."""
    incident = store.create_incident(alert_id="ALERT-123", service="database")
    incident_id = incident["incident_id"]
    
    store.set_checkpoint(
        incident_id,
        checkpoint_name="cp_remediation_approval",
        pending_action={"risk_level": "critical"},
        required_approval_from="CISO"
    )
    
    incident = store.get_incident(incident_id)
    assert incident["state"] == "awaiting_approval"
    assert incident["checkpoint"] == "cp_remediation_approval"
    assert incident["approval_required_by"] == "CISO"

def test_incident_survives_restart(store):
    """Test persistence across restarts."""
    incident = store.create_incident(alert_id="ALERT-123", service="database")
    incident_id = incident["incident_id"]
    
    # Simulate restart by creating new store instance
    store2 = IncidentStore(use_supabase=False)
    
    retrieved = store2.get_incident(incident_id)
    assert retrieved is not None
    assert retrieved["incident_id"] == incident_id
    assert retrieved["service"] == "database"
```

---

## ✅ Integration Checklist

- [ ] Copy `store.py` to `compliance/store.py`
- [ ] Update `orchestrator.py` with checkpoint logic
- [ ] Add API routes to `routes.py` or create `api.py`
- [ ] Update `templates/incident_detail.html`
- [ ] Add tests to `tests/test_store.py`
- [ ] Test full flow: create → checkpoint → approve → resolve
- [ ] Verify SQLite persistence
- [ ] Add environment variable `ENABLE_SUPABASE` (optional)
- [ ] Update README with new API endpoints
- [ ] Deploy to production

---

## 🧪 Quick Test

```bash
# Create incident and trigger checkpoint
curl -X POST http://localhost:5000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{"alert_id": "TEST-1", "service": "api", "severity": "HIGH"}'

# Returns: {"incident_id": "INC-abc123", "state": "awaiting_approval", ...}

# Approve
curl -X POST http://localhost:5000/api/incidents/INC-abc123/approve \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved"}'

# Get trace
curl http://localhost:5000/api/incidents/INC-abc123/trace | jq
```
