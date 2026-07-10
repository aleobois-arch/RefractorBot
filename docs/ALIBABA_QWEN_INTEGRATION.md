# Alibaba Cloud + Qwen Integration Guide

Complete setup for Compliance Guardian Flask on Alibaba Cloud with Qwen Cloud API.

---

## 📋 Prerequisites

1. **Alibaba Cloud Account** (https://www.alibabacloud.com)
2. **DashScope API Key** (from Alibaba Cloud Model Studio)
3. **Function Compute** (serverless, optional but recommended)
4. **Alibaba Cloud OSS** (for report storage, optional)

---

## 🔑 Step 1: Get Your Qwen API Key

### Option A: DashScope (Recommended)

```bash
# 1. Go to: https://home.qwencloud.com/api-keys
# 2. Login with your Alibaba Cloud account
# 3. Click "Create API Key"
# 4. Name it: "compliance-guardian"
# 5. Copy the key (starts with "sk-")

# Example key format:
# sk-abc123def456...xyz (64+ chars)
```

### Option B: Model Studio (Alternative)

```bash
# 1. Go to: https://dashscope.console.aliyun.com/
# 2. Navigate: Model Studio → API Key
# 3. Create new key
# 4. Select model: qwen3.7-max or qwen3.7-plus
```

**Model comparison**:
| Model | Speed | Cost | Use Case |
|-------|-------|------|----------|
| qwen3.7-max | Slow | $$$ | Complex reasoning (NIS2 reports) |
| qwen3.7-plus | Medium | $$ | General analysis (recommended) |
| qwen3.6-flash | Fast | $ | Quick classification |

**For Compliance Guardian, use**: `qwen3.7-plus` (good balance)

---

## 🛠️ Step 2: Local Setup (Development)

### Create .env file

```bash
# compliance-guardian-flask/.env

# Qwen/DashScope Configuration
QWEN_API_KEY=sk-your-key-here
QWEN_MODEL=qwen3.7-plus
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# Optional: Fallback to mock responses if Qwen is unreachable
QWEN_STRICT=0  # Set to 1 to fail on Qwen errors (for testing)

# Database (local development)
DATABASE_URL=sqlite:///incidents.db

# Optional: Supabase (for production)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key

# Optional: Alibaba Cloud OSS (for report storage)
ALIBABA_ACCESS_KEY_ID=your-access-key
ALIBABA_ACCESS_KEY_SECRET=your-secret
ALIBABA_OSS_ENDPOINT=oss-cn-beijing.aliyuncs.com
ALIBABA_OSS_BUCKET=compliance-guardian-bucket

# Flask configuration
FLASK_ENV=development
FLASK_DEBUG=1
PORT=5000
```

### Install dependencies

```bash
pip install -r requirements.txt
# Already needed:
# - requests (for Qwen API calls)
# - flask
# - python-dotenv (for .env loading)

# Optional for production:
# pip install supabase
# pip install oss2  # Alibaba Cloud OSS SDK
```

### Load environment variables

```python
# compliance/config.py (new or update existing)

import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """Base configuration."""
    QWEN_API_KEY = os.getenv("QWEN_API_KEY", "")
    QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen3.7-plus")
    QWEN_BASE_URL = os.getenv("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
    QWEN_STRICT = os.getenv("QWEN_STRICT", "0") == "1"
    
    # Database
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///incidents.db")
    
    # Supabase (optional)
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
    
    # Alibaba OSS (optional)
    ALIBABA_ACCESS_KEY_ID = os.getenv("ALIBABA_ACCESS_KEY_ID", "")
    ALIBABA_ACCESS_KEY_SECRET = os.getenv("ALIBABA_ACCESS_KEY_SECRET", "")
    ALIBABA_OSS_ENDPOINT = os.getenv("ALIBABA_OSS_ENDPOINT", "")
    ALIBABA_OSS_BUCKET = os.getenv("ALIBABA_OSS_BUCKET", "")

class DevelopmentConfig(Config):
    DEBUG = True

class ProductionConfig(Config):
    DEBUG = False
    QWEN_STRICT = False  # Fallback to mocks if Qwen unavailable
```

### Update app initialization

```python
# app.py or compliance/__init__.py

from flask import Flask
from compliance.config import DevelopmentConfig, ProductionConfig
import os

app = Flask(__name__)

# Load config
env = os.getenv("FLASK_ENV", "development")
if env == "production":
    app.config.from_object(ProductionConfig)
else:
    app.config.from_object(DevelopmentConfig)

# Initialize Qwen client
from compliance.sentinels.qwen_client import QwenClient
qwen = QwenClient(
    api_key=app.config["QWEN_API_KEY"],
    model=app.config["QWEN_MODEL"],
    base_url=app.config["QWEN_BASE_URL"],
    strict=app.config["QWEN_STRICT"]
)
```

### Test locally

```bash
# 1. Start Flask app
python app.py

# 2. Open http://localhost:5000
# 3. Upload a test incident
# 4. Check logs for Qwen API calls

# Expected output:
# [qwen] Calling Qwen API for Watcher agent...
# [qwen] Response: {"severity": "HIGH", "category": "ransomware", ...}
```

---

## ☁️ Step 3: Deploy to Alibaba Cloud Function Compute

### Why Function Compute?

| Aspect | Local Flask | Function Compute |
|--------|------------|-----------------|
| **Cost** | EC2/VPS monthly | Pay-per-execution |
| **Scaling** | Manual | Auto-scales |
| **Deployment** | Manual git + restart | Zip + upload |
| **Latency** | Depends on instance | < 100ms cold start |
| **Ideal for** | Dev/testing | Production incidents |

### Prerequisites

1. **Alibaba Cloud account** (activated)
2. **Function Compute service** enabled
3. **RAM role** with permissions (auto-created if using console)

### Deployment Steps

#### 1. Build deployment package

```bash
# Create deployment directory
mkdir -p deploy/function

# Copy code
cp -r compliance deploy/function/
cp app.py deploy/function/
cp requirements.txt deploy/function/

# Copy node_modules equivalent (Python .venv)
cd deploy/function
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# DO NOT include .venv in deployment
# Instead, use: pip install --target vendor requirements.txt

# Clean build
rm -rf deploy/function/.venv
rm -rf deploy/function/__pycache__
find deploy/function -type d -name "*.dist-info" -exec rm -rf {} +

# Install to vendor directory (for Function Compute)
cd deploy/function
pip install --target vendor -r requirements.txt
```

#### 2. Create Function Compute handler

```python
# deploy/function/index.py
"""Alibaba Cloud Function Compute entry point."""

import sys
import os

# Add vendor directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vendor'))

from flask import Flask, request
from compliance import app as compliance_app

# Wrap Flask app for Function Compute
def handler(event, context):
    """
    Alibaba Cloud Function Compute handler.
    
    Args:
        event: Request event (contains path, method, body)
        context: Execution context (contains request_id, etc.)
    
    Returns:
        dict with statusCode, headers, body
    """
    # Convert Function Compute event to WSGI environ
    environ = {
        'REQUEST_METHOD': event.get('httpMethod', 'GET'),
        'PATH_INFO': event.get('path', '/'),
        'QUERY_STRING': event.get('queryStringParameters', ''),
        'CONTENT_TYPE': event.get('headers', {}).get('content-type', ''),
        'wsgi.input': event.get('body', ''),
    }
    
    # Call Flask app
    response = compliance_app(environ, start_response)
    
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': response
    }
```

#### 3. Create Alibaba Cloud config

```yaml
# deploy/serverless.yml (for Serverless Devs CLI)

edition: 1.0.0

name: compliance-guardian
access: default  # Configure via: s configure add

services:
  compliance-guardian:
    component: fc
    props:
      region: cn-beijing  # Change to your region
      service:
        name: compliance-guardian-service
        description: AI-powered compliance incident response
        nasConfig: Auto
      function:
        name: compliance-guardian-handler
        runtime: python3.10
        timeout: 300  # 5 minutes (increase if processing large incidents)
        memorySize: 1024
        handler: index.handler
        codeUri: ./function
        environmentVariables:
          QWEN_API_KEY: ${env(QWEN_API_KEY)}
          QWEN_MODEL: qwen3.7-plus
          QWEN_BASE_URL: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
          DATABASE_URL: ${env(DATABASE_URL)}  # e.g., Supabase connection string
          FLASK_ENV: production
      triggers:
        - name: http-trigger
          type: http
          config:
            authType: ANONYMOUS
            methods:
              - GET
              - POST
              - PUT
              - DELETE
```

#### 4. Deploy

```bash
# Option A: Using Serverless Devs CLI (recommended)
npm install -g @serverless-devs/s

# Configure credentials
s configure add --access-alias default --access-key-id $ALIBABA_KEY --access-key-secret $ALIBABA_SECRET

# Deploy
cd deploy
s deploy

# Output:
# Deploying compliance-guardian...
# ✓ Service created
# ✓ Function deployed
# ✓ Trigger created
# Endpoint: https://function-name-xxxxx.cn-beijing.fc.aliyuncs.com

# Option B: Using Alibaba Console (manual)
# 1. Go to: https://fc.console.aliyun.com
# 2. Create Service → "compliance-guardian"
# 3. Create Function:
#    - Name: compliance-guardian-handler
#    - Runtime: Python 3.10
#    - Handler: index.handler
#    - Upload code: deploy/function (as .zip)
# 4. Create Trigger → HTTP
# 5. Configure environment variables
```

---

## 🗄️ Step 4: Production Database Setup

### Option A: Supabase (Recommended for Multi-Region)

```bash
# 1. Go to: https://supabase.com
# 2. Create project → "compliance-guardian"
# 3. Copy connection string (PostgreSQL)
# 4. Set in .env:

SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbG...

# 5. Update store.py to use Supabase
from compliance.store import IncidentStore

store = IncidentStore(
    use_supabase=True,
    supabase_url=config.SUPABASE_URL,
    supabase_key=config.SUPABASE_KEY
)
```

### Option B: Alibaba Cloud RDS (Native Integration)

```bash
# 1. Go to: https://console.aliyun.com/rds
# 2. Create PostgreSQL instance:
#    - Engine: PostgreSQL 13+
#    - Storage: 20 GB (start small, scale as needed)
#    - Network: VPC (same as Function Compute)
#    - Instance type: ecs.t2.small (cheap)

# 3. Create database:
#    - Name: compliance_guardian
#    - User: admin
#    - Password: (strong password)

# 4. Whitelist Function Compute IP:
#    - Security groups → Inbound rules → Add Function Compute CIDR

# 5. Connection string:
DATABASE_URL=postgresql://admin:password@rds-endpoint.rds.aliyuncs.com:5432/compliance_guardian

# 6. Update store.py to use SQLAlchemy:
from sqlalchemy import create_engine

engine = create_engine(config.DATABASE_URL)
# ... implement store.py using SQLAlchemy ORM
```

### Option C: SQLite (Local Development Only)

```bash
# Already works out-of-box:
DATABASE_URL=sqlite:///incidents.db
```

---

## 📦 Step 5: Optional - Alibaba Cloud OSS Integration

Store incident reports + evidence in Alibaba Cloud Object Storage Service (OSS).

### Setup OSS

```bash
# 1. Go to: https://console.aliyun.com/oss
# 2. Create bucket:
#    - Name: compliance-guardian-reports
#    - Region: same as Function Compute (e.g., cn-beijing)
#    - Access: Private (incidents are sensitive!)

# 3. Create RAM user with OSS permissions:
#    - Go to: https://console.aliyun.com/ram
#    - Create user → compliance-guardian-oss
#    - Grant policy: AliyunOSSFullAccess
#    - Create access key
#    - Copy Access Key ID & Secret

# 4. Set environment variables:
ALIBABA_ACCESS_KEY_ID=LTAI...
ALIBABA_ACCESS_KEY_SECRET=...
ALIBABA_OSS_ENDPOINT=oss-cn-beijing.aliyuncs.com
ALIBABA_OSS_BUCKET=compliance-guardian-reports
```

### Use OSS in code

```python
# compliance/storage/oss_client.py (new)
"""Alibaba Cloud OSS client for report storage."""

import oss2
from datetime import datetime
import os

class OSSClient:
    """Upload incident reports to Alibaba Cloud OSS."""
    
    def __init__(self):
        self.access_key_id = os.getenv("ALIBABA_ACCESS_KEY_ID")
        self.access_key_secret = os.getenv("ALIBABA_ACCESS_KEY_SECRET")
        self.endpoint = os.getenv("ALIBABA_OSS_ENDPOINT")
        self.bucket_name = os.getenv("ALIBABA_OSS_BUCKET")
        
        if not all([self.access_key_id, self.access_key_secret, self.endpoint, self.bucket_name]):
            self.client = None  # OSS disabled
            return
        
        auth = oss2.Auth(self.access_key_id, self.access_key_secret)
        self.bucket = oss2.Bucket(auth, self.endpoint, self.bucket_name)
    
    def upload_report(self, incident_id: str, report_content: str, report_type: str = "pdf") -> str:
        """
        Upload incident report to OSS.
        
        Returns: Public URL or None if OSS disabled
        """
        if not self.client:
            return None
        
        # Key format: incidents/2026/07/10/INC-xxx-report.pdf
        date = datetime.utcnow().strftime("%Y/%m/%d")
        key = f"incidents/{date}/{incident_id}-report.{report_type}"
        
        # Upload
        result = self.bucket.put_object(key, report_content)
        
        if result.status == 200:
            # Return signed URL (valid for 1 hour)
            url = self.bucket.sign_url('GET', key, 3600)
            return url
        
        return None
    
    def upload_evidence(self, incident_id: str, file_path: str) -> str:
        """Upload evidence file (timeline, logs, etc.)."""
        if not self.bucket:
            return None
        
        key = f"evidence/{incident_id}/{os.path.basename(file_path)}"
        
        with open(file_path, 'rb') as f:
            result = self.bucket.put_object(key, f.read())
        
        if result.status == 200:
            return self.bucket.sign_url('GET', key, 3600)
        
        return None
```

### Use in orchestrator

```python
# compliance/sentinels/orchestrator.py

from compliance.storage.oss_client import OSSClient

oss = OSSClient()

def _execute_remediation_and_finalize(incident_id, alert, plan, store):
    """..."""
    
    # Generate report
    report = run_scribe(alert, plan)
    
    # Upload to OSS
    report_url = oss.upload_report(incident_id, report.get("content", ""), "pdf")
    
    store.append_timeline(incident_id, "Scribe", "report_generated",
                        {"report_type": "NIS2", "oss_url": report_url})
```

---

## 🧪 Testing with Qwen API

### Test API connectivity

```python
# test_qwen_integration.py

import requests
import os

def test_qwen_api():
    """Test Qwen API connectivity."""
    api_key = os.getenv("QWEN_API_KEY")
    base_url = os.getenv("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
    
    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "qwen3.7-plus",
        "messages": [
            {"role": "user", "content": "What is 2+2?"}
        ]
    }
    
    response = requests.post(url, headers=headers, json=payload)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    
    assert response.status_code == 200, f"Qwen API error: {response.text}"
    assert "choices" in response.json()
    print("✓ Qwen API is working!")

if __name__ == "__main__":
    test_qwen_api()
```

### Run test

```bash
export QWEN_API_KEY=sk-your-key
python test_qwen_integration.py

# Expected output:
# Status: 200
# Response: {"choices": [{"message": {"content": "2+2 equals 4"}}]}
# ✓ Qwen API is working!
```

### Test with mock responses (offline)

```bash
# Set MOCK_QWEN to use canned responses
export MOCK_QWEN=1
python app.py

# Doesn't hit Qwen API, uses fallback mock responses from llm.py
```

---

## 📊 Cost Estimation

### Qwen Cloud API (DashScope)

| Model | Cost (per 1M tokens) | Estimate for 100 incidents/day |
|-------|---------------------|-------------------------------|
| qwen3.7-flash | ¥0.5 | ~¥50/month |
| qwen3.7-plus | ¥1.5 | ~¥150/month |
| qwen3.7-max | ¥3.0 | ~¥300/month |

**Recommendation**: Start with `qwen3.7-plus` (~¥150/month for 100 incidents/day)

### Alibaba Cloud Function Compute

| Component | Cost |
|-----------|------|
| **Invocations** | ¥0.0000002 per call (~¥0/month for <1M calls) |
| **Compute time** | ¥0.0000167 per GB-second (300s * 1GB = ¥0.005 per incident) |
| **Data transfer** | ¥0.50 per GB (outbound) |
| **Monthly estimate** | ~¥50-200 (for 100 incidents/day) |

### Alibaba Cloud RDS (Optional)

| Instance | Monthly Cost |
|----------|-------------|
| **ecs.t2.small** | ~¥100 |
| **Storage (20GB)** | ~¥20 |

### Total Monthly (Production)

```
Qwen Cloud:     ~¥150 (API calls)
Function Compute: ~¥100 (serverless execution)
RDS (optional): ~¥120 (database)
OSS (optional): ~¥50 (report storage)
─────────────────────
Total:          ~¥420/month (~$60 USD)
```

---

## 🔒 Security Best Practices

### 1. API Key Management

```bash
# ✅ DO: Use environment variables
export QWEN_API_KEY=sk-...
python app.py

# ❌ DON'T: Hardcode in source
QWEN_API_KEY = "sk-..."  # BAD!

# ✅ DO: Use Alibaba RAM secrets
# Function Compute → Environment Variables → Set QWEN_API_KEY from RAM Secret
```

### 2. Network Security

```yaml
# Deploy in VPC
# Function Compute → Network Configuration
#   - VPC: Same as RDS/OSS
#   - NAT Gateway: For outbound to Qwen API
#   - Security Group: Restrict to necessary IPs only
```

### 3. Database Security

```bash
# Enable SSL/TLS
# RDS Console → Security → Modify SSL
# Force SSL connections for all clients
```

### 4. IAM Permissions (Least Privilege)

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "fc:InvokeFunction"
      ],
      "Resource": [
        "arn:aliyun:fc:*:*:services/compliance-guardian-service/functions/handler"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject"
      ],
      "Resource": [
        "arn:aliyun:oss:::compliance-guardian-reports/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## ✅ Deployment Checklist

### Before Production

- [ ] Create Alibaba Cloud account + activate services
- [ ] Get DashScope API key (qwen3.7-plus model)
- [ ] Create Function Compute service
- [ ] Create RDS PostgreSQL or Supabase account
- [ ] Create OSS bucket for reports
- [ ] Set all environment variables
- [ ] Test Qwen API connectivity
- [ ] Test database persistence
- [ ] Test OSS upload
- [ ] Load test: 100+ concurrent incidents
- [ ] Verify NIS2 compliance logging
- [ ] Set up CloudWatch/CloudMonitor alarms
- [ ] Document deployment procedure
- [ ] Create runbook for production issues

### After Deployment

- [ ] Monitor Function Compute logs
- [ ] Monitor Qwen API quota usage
- [ ] Monitor database storage growth
- [ ] Monitor OSS storage growth
- [ ] Verify incident processing latency
- [ ] Verify human approvals persist across restarts
- [ ] Backup database weekly
- [ ] Archive old incidents monthly

---

## 📞 Troubleshooting

### "Qwen API: Invalid API Key"

```bash
# Check:
echo $QWEN_API_KEY
# Should print: sk-...

# Verify key at:
# https://home.qwencloud.com/api-keys

# Re-set if needed:
export QWEN_API_KEY=sk-correct-key
```

### "Function Compute timeout"

```bash
# Increase timeout:
# Function Compute Console → Function Details → Timeout
# Set to 300 seconds (5 minutes) minimum

# Or in serverless.yml:
timeout: 300
```

### "RDS connection refused"

```bash
# Check:
# 1. Security group allows Function Compute CIDR
# 2. RDS publicly accessible (if connecting from outside VPC)
# 3. Connection string is correct: postgresql://user:pass@host/db
```

### "OSS permission denied"

```bash
# Check RAM user permissions:
# RAM Console → Users → compliance-guardian-oss
# Policies → AliyunOSSFullAccess (attached?)
# Access Keys → Still valid?
```

---

## 🚀 Next Steps

1. **Get Qwen API Key** (5 min) — Go to https://home.qwencloud.com/api-keys
2. **Set .env locally** (5 min) — Add QWEN_API_KEY
3. **Test Qwen API** (5 min) — Run test_qwen_integration.py
4. **Deploy to Function Compute** (20 min) — Follow deployment steps
5. **Monitor production** (ongoing) — Watch logs + metrics

---

## 📚 References

- **DashScope Docs**: https://dashscope.console.aliyun.com/docs
- **Function Compute Guide**: https://www.alibabacloud.com/help/en/function-compute/
- **Alibaba Cloud OSS**: https://www.alibabacloud.com/help/en/oss/
- **Qwen Models**: https://qwenlm.github.io/blog/qwen-max/

---

## 💡 Quick Reference

```bash
# Development
export QWEN_API_KEY=sk-...
export QWEN_MODEL=qwen3.7-plus
export QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
export MOCK_QWEN=0  # Use real API
python app.py

# Production (Alibaba Cloud)
# → Function Compute environment variables
# → Auto-scales on demand
# → Pay per use
# → Fully integrated with Alibaba ecosystem
```

---

**Ready to deploy Compliance Guardian on Alibaba Cloud?** ✅
