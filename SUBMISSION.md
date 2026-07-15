# Devpost Submission — RefactorBot Society

> Draft submission package for the Global AI Hackathon with Qwen Cloud.
> Copy the sections below into the Devpost "Enter a Submission" form.

## Track

**Track 3: Agent Society**

## Elevator pitch (short)

A society of Qwen agents that engineers legacy-code modernization instead of just translating it: a parallel three-specialist QA panel that genuinely disagrees, a Senior Reviewer that arbitrates conflicts and breaks negotiation stalls — and a built-in blind-judged benchmark proving the society beats a single-agent baseline.

## Text description (features & functionality)

**The problem.** Single-prompt LLM refactors hallucinate, ship injection vulnerabilities, and miss enterprise architecture. Code modernization needs engineering discipline, not translation.

**The society.** Fed legacy code through the dashboard or API, the pipeline runs:

1. **The Parser** (routed to `qwen-turbo` — cost optimization) extracts structure and deprecated patterns.
2. **The Architect** designs the target framework (typed models, async handlers, error strategy).
3. **The Developer** drafts the code.
4. **The QA Review Panel** — *three specialists run concurrently* (one wall-clock round-trip): Security QA, Performance QA, and Correctness QA. Each returns a structured verdict `{ approved, severity: none|minor|major|blocker, feedback }`. Being independent, they routinely disagree.
5. **The Senior Reviewer** arbitrates: reconciles conflicting verdicts into one prioritized fix list (security prevails over style; correctness constraints may never be broken by a fix), and the Developer rewrites.

**Conflict resolution & stall breaking (Track 3 core).** Panel disagreement (`N approve / M reject`) is detected and escalated explicitly — visible live in the timeline. If the panel raises identical objections two rounds in a row, the orchestrator declares the negotiation stalled and instructs the arbiter to impose a substantially different implementation strategy instead of another incremental patch.

**Measurable gain over a single-agent baseline (Track 3 requirement).** `POST /benchmark` (or the 🏁 dashboard button) runs the same input through (a) a single-shot single-agent refactor and (b) the full society, then has an independent Qwen judge score both outputs **blind** on a fixed rubric (security / correctness / architecture / maintainability, 0–10). The report includes both scores, token spend, wall-clock time, and the deltas — what the extra tokens actually buy.

**Also included:** a second five-agent society for NIS2 (EU Directive 2022/2555, Art. 23) security-incident response, live SSE streaming of every negotiation, per-agent token telemetry, retry/backoff on all Qwen calls, and an offline mock mode with a *stateful* QA panel so the reject → arbitrate → approve cycle is demonstrable without credits.

## How the project was significantly updated during the Submission Period

The project was substantially extended during the Submission Period (July 2026):

- Replaced the single QA agent with a **parallel three-specialist QA panel** (Security/Performance/Correctness) producing structured severity verdicts.
- Added **explicit disagreement detection** and Senior-Reviewer **arbitration**, plus **stall detection** that forces a strategy change when objections repeat.
- Added the **single-agent baseline benchmark with a blind Qwen judge** — the measurable-efficiency-gain requirement of Track 3.
- Added **SSE live streaming** of agent negotiations, per-agent **token telemetry**, per-agent **model routing** (`qwen-turbo` for parsing), retry/backoff with timeouts, and an open-source **MIT LICENSE** file.

## Proof of Alibaba Cloud deployment (code links)

- `src/qwen.ts` — Qwen via the DashScope native API (`dashscope-intl.aliyuncs.com`).
- `src/orchestrator.ts` — Alibaba Function Compute runtime detection (`FC_FUNC_CODE_PATH`) with `/tmp` write fallback.
- README § "Alibaba Cloud Deployment Guide" — Function Compute custom-runtime deployment steps.

## Architecture diagram

See the Mermaid diagram in [README.md](README.md#%EF%B8%8F-architecture-flow) (rendered natively by GitHub).

## Testing instructions (for judges)

No API key or cloud account is required to evaluate the full negotiation and the benchmark:

```bash
git clone https://github.com/aleobois-arch/RefractorBot.git
cd RefractorBot
npm install && npm run build
MOCK_QWEN=1 npm start
# open http://localhost:9000
```

Click **"Load sample legacy code"** → **"Initiate Agent Protocol"**: watch Security QA reject the first draft while the other reviewers approve, the disagreement escalation, the arbitration, and the unanimous re-approval. Then click **"🏁 Benchmark vs Single Agent"** for the side-by-side scored comparison. The NIS2 society lives at `/nis2`.

To run against live Qwen Cloud: put `QWEN_API_KEY` in `.env` and start without `MOCK_QWEN`.

## Video

- [ ] TODO: record the 3-minute demo (script scene-by-scene in README § "3-minute demo script"), upload to YouTube/Vimeo/Youku as **public**, paste the link here and in the Devpost form.

## Open source license

MIT — `LICENSE` at the repository root (auto-detected by GitHub and shown in the About sidebar).
