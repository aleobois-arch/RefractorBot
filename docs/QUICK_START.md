# Quick Start: Améliorer Compliance Guardian Flask

**Durée estimée**: 3 jours · **Difficulté**: Medium · **Impact**: High (compliance-critical)

---

## 📋 Résumé en 30 secondes

Vous avez deux excellents projets :
- **Compliance Guardian** : 5 agents intelligents pour la triage d'incident NIS2 ✅
- **Qwen Autopilot Agent** : État machine résilient + checkpoint HITL ✅

**Le problème** : Compliance Guardian perd tout son état quand le serveur redémarre (incidents en mémoire).

**La solution** : Emprunter l'architecture de Qwen Autopilot (persistent store + checkpoints nommés).

**Le résultat** : Les incidents survivent aux redémarrages, les approbations humaines sont durables, l'audit trail est immuable.

---

## 🎯 Objectif

Transformer Compliance Guardian d'une app **ephemeral** (perte tout à la fermeture) à **durable** (tout persiste).

### Avant
```
Incident → Agent pipeline → In-memory state → ⚠️ Server restarts → Lost forever
```

### Après
```
Incident → Agent pipeline → SQLite/Supabase → Persisted → Human approves → Resume → Done
           (durée: 30s-2min)               (checkpoint)   (peut attendre 72h+)
```

---

## 📦 What You Get (3 New Files to Copy-Paste)

| File | Purpose | Size |
|------|---------|------|
| `IMPROVEMENTS_GUIDE.md` | 🎯 Detailed recommendations + code samples | 15 KB |
| `ARCHITECTURE_COMPARISON.md` | 🏗️ Visual comparison of both architectures | 12 KB |
| `IMPLEMENTATION_SNIPPETS.md` | 💻 Ready-to-use code (store, API, templates) | 25 KB |

**Total**: ~52 KB of docs + snippets (all copy-paste ready).

---

## 🚀 3-Day Implementation Plan

### Day 1: Add Persistence (4-5 hours)

**Goal**: Make incidents persist across server restarts

```bash
# Step 1: Copy store.py
cp IMPLEMENTATION_SNIPPETS.md → compliance/store.py

# Step 2: Refactor orchestrator to use store
# In run_pipeline():
#   - Call store.create_incident() instead of in-memory init
#   - Call store.append_timeline() after each agent step
#   - Call store.set_checkpoint() instead of flag setting

# Step 3: Test persistence
python -c "
  from compliance.store import IncidentStore
  store = IncidentStore()
  inc = store.create_incident('ALERT-1', service='api')
  store.append_timeline(inc['incident_id'], 'Watcher', 'done', {})
  print(store.get_incident(inc['incident_id']))
"
# Should print incident even after process restarts
```

**Files to modify**:
- `compliance/sentinels/orchestrator.py` (+100 lines)
- `compliance/store.py` (NEW, ~250 lines from snippet)

**Time allocation**:
- Read IMPROVEMENTS_GUIDE.md: 20 min
- Create store.py from snippet: 10 min
- Refactor orchestrator: 90 min
- Test + debug: 60 min

---

### Day 2: Add Checkpoints + HITL Resume (4-5 hours)

**Goal**: Implement durable human-approval checkpoints

```bash
# Step 1: Add checkpoint constants
# In orchestrator.py:
CHECKPOINT_REMEDIATION_APPROVAL = "cp_remediation_approval"

# Step 2: Add HITL logic
# if remediation_risk == "critical":
#     store.set_checkpoint(...)
#     return incident_id  # Pause pipeline
# else:
#     continue()  # Auto-approve for low risk

# Step 3: Implement resume_incident()
# When human approves: orchestrator.resume_incident(incident_id, "approved")

# Step 4: Add API endpoints
# POST /api/incidents/{id}/approve
# GET /api/incidents/{id}
```

**Files to modify**:
- `compliance/sentinels/orchestrator.py` (+100 lines, resume logic)
- `compliance/routes.py` or `compliance/api.py` (NEW, ~150 lines)

**Test**:
```bash
# Create incident
curl -X POST http://localhost:5000/api/incidents \
  -d '{"alert_id":"TEST","service":"api","severity":"HIGH"}'
# → returns {"incident_id":"INC-xxx", "state":"awaiting_approval"}

# Approve it
curl -X POST http://localhost:5000/api/incidents/INC-xxx/approve \
  -d '{"decision":"approved"}'
# → continues pipeline automatically
```

**Time allocation**:
- Read ARCHITECTURE_COMPARISON.md: 20 min
- Implement checkpoint logic: 100 min
- Implement resume_incident(): 80 min
- Test + debug: 60 min

---

### Day 3: Enhanced Dashboard + QA (4-5 hours)

**Goal**: Show human-facing checkpoint UI + full audit trail

```bash
# Step 1: Update incident_detail.html template
# Add: checkpoint badge, approval form, timeline visualization

# Step 2: Add /incidents/<id>/trace endpoint
# Returns: {"state":"...", "timeline":[{timestamp,agent,event,data},...]}

# Step 3: Test E2E
# - Upload incident
# - See "Awaiting CISO approval" badge
# - Edit remediation plan (optional)
# - Click "Approve"
# - See pipeline continue
# - See final report
```

**Files to modify**:
- `templates/incident_detail.html` (UPDATE, +200 lines)
- `compliance/api.py` (ADD trace endpoint, +30 lines)

**Test**:
```bash
# Full E2E
python app.py
# Open http://localhost:5000/incidents
# Upload test alert
# See checkpoint pause
# Click approve
# See resolution
```

**Time allocation**:
- Design template + CSS: 80 min
- Implement API trace endpoint: 30 min
- Manual testing + refinement: 100 min
- Regression testing: 30 min

---

## 📊 Expected Metrics After

| Metric | Before | After | Gain |
|--------|--------|-------|------|
| **Data loss on restart** | 100% | 0% | ✅ Complete fix |
| **HITL checkpoint durability** | No | Yes | ✅ 72h+ pending |
| **Audit trail** | Ephemeral | Immutable + timestamped | ✅ Compliance-ready |
| **UX clarity** | "Incident processing..." | "Awaiting CISO approval (3h pending)" | ✅ Crystal clear |
| **Code size** | 230 lines | ~620 lines | 2.7x growth, justified |

---

## 🛠️ Tech Stack (No Changes Required)

| Layer | Technology | Change? |
|-------|-----------|---------|
| **Backend** | Flask | No change |
| **Database** | SQLite (local) or Supabase (prod) | ✅ ADD (fallback to SQLite) |
| **ORM** | SQLAlchemy (optional, using raw SQL for simplicity) | No change |
| **Frontend** | Jinja2 + Tailwind | Minor template expansion |
| **AI** | Qwen Cloud (DashScope) | No change |

---

## ✅ Pre-Implementation Checklist

- [ ] Read `IMPROVEMENTS_GUIDE.md` (establishes "why")
- [ ] Read `ARCHITECTURE_COMPARISON.md` (establishes "what architecture")
- [ ] Read `IMPLEMENTATION_SNIPPETS.md` (establishes "how to code")
- [ ] Backup current codebase: `git commit -am "pre-improvements backup"`
- [ ] Create feature branch: `git checkout -b feature/persistent-store`
- [ ] Install any new deps (if needed): `pip install python-dotenv` (already in requirements.txt?)
- [ ] Ensure SQLite3 is available (built-in to Python 3.8+)
- [ ] Test current app works: `python app.py` → open http://localhost:5000

---

## 🔗 Key Code Locations (for reference)

**Current Compliance Guardian**:
```
compliance/
├── sentinels/
│   ├── orchestrator.py  ← Where to add checkpoint + resume logic
│   ├── agents/
│   │   ├── watcher.py
│   │   ├── tracker.py
│   │   ├── diagnostician.py
│   │   ├── engineer.py
│   │   └── scribe.py
│   └── types.py         ← May need new types (e.g., Checkpoint, Timeline)
├── store.py             ← NEW FILE (from snippet)
├── routes.py or app.py  ← Where to add /api/incidents/* endpoints
└── templates/
    └── incident_detail.html ← Where to add checkpoint UI
```

---

## 🎓 Learning Path

If unfamiliar with any concept:

1. **SQLite basics** → [SQLite Tutorial](https://www.sqlite.org/docs.html) (5 min)
2. **State machines** → [Wikipedia: UML State Machine](https://en.wikipedia.org/wiki/UML_state_machine) (10 min)
3. **Human-in-the-Loop AI** → [HuggingFace Blog: HITL Systems](https://huggingface.co/docs) (15 min)
4. **Qwen Autopilot's approach** → Read `backend/app/orchestrator.py` in qwen-autopilot-agent (20 min)

---

## 🚨 Risk Mitigation

### Risk 1: Breaking existing API
**Mitigation**: New endpoints only, old endpoints unchanged.

### Risk 2: SQLite concurrency
**Mitigation**: Use `isolation_level=None` for auto-commit, or queue long operations async.

### Risk 3: Schema migration on prod
**Mitigation**: SQLite schema auto-creates on first store init; no migration script needed.

### Risk 4: Large timeline/audit trail
**Mitigation**: Pagination in list_incidents(); archive old incidents to separate table monthly.

---

## 📞 Support Resources

**In this scratchpad**:
- `IMPROVEMENTS_GUIDE.md` — Detailed "why" + conceptual code
- `ARCHITECTURE_COMPARISON.md` — "What" (side-by-side diagrams)
- `IMPLEMENTATION_SNIPPETS.md` — "How" (copy-paste code)

**External**:
- Qwen Autopilot source: `backend/app/store.py` (reference implementation)
- Flask best practices: [Flask-SQLAlchemy docs](https://flask-sqlalchemy.palletsprojects.com/)

---

## 🎯 Success Criteria (Mandatory)

Before calling it "done":

- [ ] Incidents persist across server restart (test: kill -9 Flask, restart, check GET /api/incidents)
- [ ] Human approvals survive 72h+ pending (test: set checkpoint, wait 72h, resume should work)
- [ ] Audit trail is immutable (test: timeline cannot be edited, only appended)
- [ ] Dashboard shows "Awaiting [Role] approval since [time]" correctly
- [ ] All existing tests pass
- [ ] New store tests have ≥85% coverage
- [ ] No data loss from current production (backup + test migration)

---

## 📅 Timeline

| Day | Task | Hours | Deliverable |
|-----|------|-------|-------------|
| 1 | Persistence layer | 5 | Incidents survive restarts |
| 2 | Checkpoint + HITL | 5 | Human-approvable incidents |
| 3 | Dashboard + QA | 5 | Full E2E working |
| **Total** | | **~15** | **Production-ready** |

---

## 🎓 Key Takeaways

1. **Qwen Autopilot's architecture is battle-tested** — use it as a reference
2. **Persistence is non-negotiable** — incidents are compliance-critical
3. **Checkpoints must be named and durable** — not flags, not in-memory
4. **Audit trails are mandatory** — NIS2 compliance depends on them
5. **3-day scope is achievable** — existing agents stay untouched

---

## 🚀 Let's Go

1. **Read the 3 docs** (IMPROVEMENTS_GUIDE.md, ARCHITECTURE_COMPARISON.md, IMPLEMENTATION_SNIPPETS.md)
2. **Create feature branch**: `git checkout -b feature/persistent-store`
3. **Day 1**: Copy `store.py`, refactor orchestrator
4. **Day 2**: Add checkpoints + resume logic
5. **Day 3**: Dashboard + testing
6. **Push**: `git push -u origin feature/persistent-store`
7. **PR**: Create pull request, assign reviewer

---

**Status**: Ready to implement ✅  
**Confidence**: High (reference implementation available)  
**Risk**: Low (non-breaking, backward-compatible)  

---

Next steps?
1. Start with Day 1 implementation
2. Reach out if any blockers
3. Target: Production deployment by end of week

**Good luck!** 🚀
