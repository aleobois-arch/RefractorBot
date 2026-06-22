# 🤖 RefactorBot Society

![Hackathon](https://img.shields.io/badge/Track_3-Agent_Society-blue?style=for-the-badge)
![Cloud](https://img.shields.io/badge/Hosted_on-Alibaba_Cloud-FF6600?style=for-the-badge&logo=alibabacloud&logoColor=white)
![AI](https://img.shields.io/badge/Powered_by-Qwen_Turbo-8B5CF6?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**RefactorBot Society** is an autonomous, serverless multi-agent pipeline hosted on Alibaba Cloud Function Compute. Designed to modernize and secure legacy code, it triggers a "society" of specialized AI personas powered by Qwen Large Language Models to architect, write, and aggressively QA code before it ever reaches production.

Built by JemBuildz.

---

## 💡 Inspiration
Legacy code modernization is usually a painful, manual process. While single-prompt LLMs can translate code from one language to another, they frequently hallucinate, introduce security vulnerabilities (like SSRF or CORS misconfigurations), and fail to grasp enterprise architecture. We wanted to build a system that doesn't just translate code, but *engineers* it.

## ⚙️ How The Society Works
When fed legacy monolithic code via the interactive Glassmorphism UI, it triggers a rigorous negotiation loop between five distinct personas:

1. **The Parser:** Dissects the legacy logic and identifies deprecated patterns.
2. **The Architect:** Designs a modern, asynchronous target framework (e.g., FastAPI).
3. **The Developer:** Drafts the initial code based on the Architect's blueprint.
4. **The QA Engineer:** A ruthless security and performance reviewer. It actively hunts for resource leaks, unhandled exceptions, and architectural flaws, rejecting the code until it meets enterprise standards.
5. **The Senior Reviewer:** Mediates any QA rejections and provides actionable fix instructions back to the Developer.

Code is only output to the user once it survives this loop and passes the QA Engineer's strict approval.

---

## 🗺️ Architecture Flow

```mermaid
graph TD
    %% Styling
    classDef user fill:#3b82f6,stroke:#1e40af,stroke-width:2px,color:#fff;
    classDef cloud fill:#f97316,stroke:#c2410c,stroke-width:2px,color:#fff;
    classDef agent fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef qwen fill:#8b5cf6,stroke:#5b21b6,stroke-width:2px,color:#fff;

    %% Nodes
    A[User Frontend UI]:::user -->|POST /refactor| B(Alibaba Function Compute)
    
    subgraph Serverless Backend [Alibaba Cloud Custom Runtime]
        B:::cloud --> C{Orchestrator Loop}
        
        C --> D[Parser Agent]:::agent
        C --> E[Architect Agent]:::agent
        
        %% Negotiation Loop
        subgraph Agent Negotiation Loop
            F[Developer Agent]:::agent --> G{QA Engineer}:::agent
            G -- Rejects Code --> H[Senior Reviewer]:::agent
            H -- Fix Instructions --> F
        end
        
        E --> F
        G -- Approves Code --> I[Final Code Output]
    end

    %% API Calls
    D -.->|API Call| Q[Qwen Cloud API]:::qwen
    E -.->|API Call| Q
    F -.->|API Call| Q
    G -.->|API Call| Q
    H -.->|API Call| Q

    I -->|JSON Response| A

## 🛠️ Tech Stack

* **AI Brain:** Alibaba Cloud DashScope API (Qwen Large Language Models)
* **Orchestration:** Node.js / Express built with TypeScript
* **Infrastructure:** Alibaba Cloud Function Compute (Custom Runtime, Serverless)
* **Frontend:** HTML/CSS/JS Glassmorphism UI rendering real-time JSON timeline logs to visualize agent negotiations.

---

## 🚀 Setup & Local Deployment

### Prerequisites

* Node.js (v18+)
* An Alibaba Cloud Account & DashScope API Key
* TypeScript

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/yourusername/refactorbot-society.git](https://github.com/yourusername/refactorbot-society.git)
    cd refactorbot-society
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create a `.env` file in the root directory:**
    ```env
    QWEN_API_KEY=your_dashscope_api_key_here
    PORT=9000
    ```

4.  **Build the TypeScript files:**
    ```bash
    npm run build
    ```

5.  **Start the local server:**
    ```bash
    npm start
    ```

---

## ☁️ Alibaba Cloud Deployment Guide

This project is configured specifically for **Alibaba Cloud Function Compute (Custom Runtime)**.

1.  Run `npm run build` to generate the updated `dist` folder.
2.  Select the following 4 items in your file explorer:
    * `dist/` (folder)
    * `node_modules/` (folder)
    * `package.json`
    * `.env`
3.  Compress these 4 items directly into a `.zip` file (Do not zip the parent folder, zip the items themselves).
4.  Upload the `deploy.zip` file to your Alibaba Cloud Function Compute instance.
5.  Ensure the Function Start Command is set to: `node dist/server.js`

---

## ⚙️ Advanced Configuration: Tuning the Agent Society

By default, the RefactorBot Society is configured to allow a maximum of 3 negotiation cycles between the Developer and the QA Engineer. If the QA Engineer is not satisfied by the third attempt, the loop terminates to prevent infinite API calls and runaway cloud costs.

You can easily tune this limit to give the Developer agent more chances to fix highly complex legacy code.

### 1. Adjusting the Cycle Limit
Open `src/orchestrator.ts` and locate the `MAX_ATTEMPTS` constant in the `runRefactorBot` function:

```typescript
// src/orchestrator.ts
let approved = false;
let attempts = 0;
const MAX_ATTEMPTS = 3; // Increase this number to allow more negotiation cycles

while (!approved && attempts < MAX_ATTEMPTS) {
    // ... agent loop ...
}

### 2. Synchronizing Cloud Timeouts
If you increase the `MAX_ATTEMPTS`, you must also increase your Alibaba Cloud Function Compute execution timeout. An extended AI debate will trigger a serverless timeout if not properly configured.

**Rule of Thumb:** Allow approximately 90–100 seconds per cycle.

* **3 Cycles (Default):** Set Alibaba Cloud Timeout to **300 seconds** (5 minutes).
* **5 Cycles:** Set Alibaba Cloud Timeout to **600 seconds** (10 minutes).

**To update the timeout in Alibaba Cloud:**
1. Navigate to your Function Compute console.
2. Select your function and click **Configurations**.
3. Under Basic Settings, change the **Execution Timeout Period**.
4. Save and deploy the new configuration.

---

## 👨‍💻 Author
**Jeremy Codjoe** — Technology Operations Analyst & Creator of JemBuildz  
*Track 3 Submission for the Agent Society Hackathon.*

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
