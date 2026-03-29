# Fypod Azure Functions Backend

Backend serverless untuk Fypod SaaS platform menggunakan Azure Functions (Python).

## 📁 Structure

```
azure-backend/
├── analyze/                    # HTTP Trigger Function
│   ├── __init__.py            # Main function code
│   └── function.json          # Function configuration
├── host.json                  # Host configuration
├── requirements.txt           # Python dependencies
├── local.settings.json        # Local settings (gitignored)
└── local.settings.json.example # Template for local settings
```

## 🔧 Setup

### Prerequisites

- Python 3.9 or higher
- Azure Functions Core Tools v4
- Azure CLI
- VS Code with Azure Functions extension (recommended)

### Local Development

1. **Create virtual environment:**
```bash
python -m venv .venv
```

2. **Activate virtual environment:**
```bash
# Windows
.venv\Scripts\activate

# Linux/Mac
source .venv/bin/activate
```

3. **Install dependencies:**
```bash
pip install -r requirements.txt
```

4. **Configure local settings:**
```bash
cp local.settings.json.example local.settings.json
```

Edit `local.settings.json` dengan credentials Anda:
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "KEY_VAULT_URL": "https://fypod-keyvault.vault.azure.net/",
    "COSMOS_ENDPOINT": "https://fypod-cosmos-db.documents.azure.com:443/",
    "SUPABASE-JWT-SECRET": "your-jwt-secret",
    "SUMOPOD-API-KEY": "your-api-key",
    "COSMOS-KEY": "your-cosmos-key"
  }
}
```

5. **Run locally:**
```bash
func start
```

Function akan berjalan di `http://localhost:7071/api/analyze`

## 🧪 Testing Locally

### Test dengan curl:
```bash
curl -X POST http://localhost:7071/api/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "jobDescription": "Looking for a Python developer with 3 years experience in Django and FastAPI. Must have experience with PostgreSQL and Redis.",
    "model": "claude-haiku-4-5"
  }'
```

### Test dengan Postman:
1. Method: POST
2. URL: `http://localhost:7071/api/analyze`
3. Headers:
   - `Content-Type: application/json`
   - `Authorization: Bearer YOUR_JWT_TOKEN`
4. Body (raw JSON):
```json
{
  "jobDescription": "Your job description here...",
  "model": "claude-haiku-4-5"
}
```

### Get JWT Token for Testing:
```javascript
// Run in browser console (popup.html)
AuthService.getToken().then(token => console.log(token));
```

## 🚀 Deployment

### Method 1: Azure Functions Core Tools (CLI)

```bash
# Login to Azure
az login

# Deploy
func azure functionapp publish fypod-functions
```

### Method 2: VS Code (Recommended)

1. Install Azure Functions extension
2. Open Command Palette (Ctrl+Shift+P)
3. Select "Azure Functions: Deploy to Function App"
4. Select your subscription
5. Select "fypod-functions"
6. Confirm deployment

### Method 3: Azure Portal

1. Zip the entire `azure-backend` folder
2. Go to Azure Portal > Function App
3. Select "Deployment Center"
4. Choose "ZIP Deploy"
5. Upload the zip file

## 📊 Monitoring

### View Logs (CLI):
```bash
az webapp log tail --name fypod-functions --resource-group fypod-hackathon-27
```

### View Logs (Portal):
1. Go to Function App in Azure Portal
2. Select "Monitor" > "Log stream"
3. Watch real-time logs

### Check Metrics:
1. Go to Function App in Azure Portal
2. Select "Metrics"
3. View:
   - Function Execution Count
   - Function Execution Units
   - Http Server Errors
   - Response Time

## 🔐 Security

### Managed Identity
Function App menggunakan System Assigned Managed Identity untuk akses ke:
- Azure Key Vault (read secrets)
- Azure Cosmos DB (read/write data)

### Secrets Management
Semua secrets disimpan di Azure Key Vault:
- `SUPABASE-JWT-SECRET`: Untuk verify JWT tokens
- `SUMOPOD-API-KEY`: Master API key
- `COSMOS-KEY`: Cosmos DB access key

### JWT Verification
Setiap request harus include valid JWT token dari Supabase:
```
Authorization: Bearer <jwt_token>
```

Token diverifikasi menggunakan PyJWT dengan Supabase JWT secret.

## 📝 API Documentation

### Endpoint: POST /api/analyze

**Request:**
```json
{
  "jobDescription": "string (required)",
  "cvData": "string (optional)",
  "model": "string (optional, default: claude-haiku-4-5)"
}
```

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

**Response (Success - 200):**
```json
{
  "analysis": {
    "matchScore": 75,
    "gaps": [
      "Missing: Docker → Fydemy: 'Docker Fundamentals'",
      "Missing: Kubernetes → Fydemy: 'Kubernetes Basics'",
      "Missing: CI/CD → Fydemy: 'DevOps Pipeline'"
    ],
    "scamDetection": {
      "isScam": false,
      "reason": "",
      "salaryRange": "$60,000 - $80,000"
    },
    "questions": [
      "How would you design a scalable microservices architecture?",
      "Explain your approach to database optimization.",
      "Describe a challenging bug you fixed recently."
    ],
    "insights": {
      "careerGrowth": {
        "score": 4,
        "reason": "Strong growth potential in cloud-native development"
      },
      "techModernity": {
        "score": 5,
        "reason": "Cutting-edge tech stack with modern frameworks"
      },
      "learningOpportunities": "Kubernetes, microservices, cloud architecture",
      "workLifeBalance": "Good",
      "cultureFit": "Startup - Fast-paced, innovative environment"
    }
  },
  "credits_remaining": 9,
  "reset_date": "2027-03-29T00:00:00Z"
}
```

**Response (Insufficient Credits - 403):**
```json
{
  "error": "Insufficient credits",
  "credits_remaining": 0,
  "reset_date": "2027-03-29T00:00:00Z"
}
```

**Response (Unauthorized - 401):**
```json
{
  "error": "Invalid or expired token"
}
```

**Response (Bad Request - 400):**
```json
{
  "error": "Missing jobDescription in request"
}
```

**Response (Server Error - 500):**
```json
{
  "error": "Internal server error"
}
```

## 🗄️ Database Schema

### Cosmos DB Container: Users

```json
{
  "id": "user-uuid-from-supabase",
  "credits_remaining": 10,
  "last_reset": "2027-03-28T00:00:00Z",
  "created_at": "2027-03-01T10:30:00Z"
}
```

**Partition Key:** `/id`

### Credit Reset Logic
- Credits reset to 10 setiap hari
- Reset terjadi saat first request setelah midnight UTC
- Lazy reset (tidak menggunakan scheduled job)

## 🔧 Configuration

### Environment Variables (Function App Settings)

| Variable | Description | Example |
|----------|-------------|---------|
| `KEY_VAULT_URL` | Azure Key Vault URL | `https://fypod-keyvault.vault.azure.net/` |
| `COSMOS_ENDPOINT` | Cosmos DB endpoint | `https://fypod-cosmos-db.documents.azure.com:443/` |

### Secrets (Key Vault)

| Secret Name | Description |
|-------------|-------------|
| `SUPABASE-JWT-SECRET` | Supabase JWT secret untuk verify tokens |
| `SUMOPOD-API-KEY` | Master API key untuk Sumopod |
| `COSMOS-KEY` | Cosmos DB primary key |

## 🐛 Troubleshooting

### Error: "Failed to get secret"
**Cause:** Managed Identity tidak punya permission ke Key Vault

**Solution:**
```bash
PRINCIPAL_ID=$(az functionapp identity show --name fypod-functions --resource-group fypod-hackathon-27 --query principalId -o tsv)
az keyvault set-policy --name fypod-keyvault --object-id $PRINCIPAL_ID --secret-permissions get list
```

### Error: "Invalid or expired token"
**Cause:** JWT token tidak valid atau sudah expired

**Solution:**
- Check JWT secret di Key Vault
- Verify token belum expired
- Get new token dari Supabase

### Error: "Cosmos DB connection failed"
**Cause:** Cosmos DB credentials tidak valid

**Solution:**
```bash
# Get new Cosmos key
az cosmosdb keys list --name fypod-cosmos-db --resource-group fypod-hackathon-27

# Update Key Vault
az keyvault secret set --vault-name fypod-keyvault --name COSMOS-KEY --value "NEW_KEY"
```

### Function timeout
**Cause:** Sumopod API call terlalu lama

**Solution:**
- Increase timeout di `host.json`
- Check Sumopod API status
- Implement retry logic

## 📈 Performance

### Cold Start
- First request: ~2-3 seconds
- Subsequent requests: ~200-500ms

### Optimization Tips
1. Keep function warm dengan scheduled ping
2. Use connection pooling untuk Cosmos DB
3. Cache secrets in memory
4. Minimize dependencies

## 💰 Cost Estimation

### Free Tier Limits
- **Executions:** 1,000,000 per month
- **Execution Time:** 400,000 GB-s per month

### Estimated Usage (1000 users/day)
- **Requests:** ~10,000/month (10 per user)
- **Execution Time:** ~50,000 GB-s/month
- **Cost:** $0 (within free tier)

## 🔄 CI/CD (Optional)

### GitHub Actions

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Azure Functions

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Python
      uses: actions/setup-python@v2
      with:
        python-version: '3.10'
    
    - name: Install dependencies
      run: |
        cd azure-backend
        pip install -r requirements.txt
    
    - name: Deploy to Azure
      uses: Azure/functions-action@v1
      with:
        app-name: fypod-functions
        package: azure-backend
        publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

## 📚 Resources

- [Azure Functions Python Developer Guide](https://docs.microsoft.com/azure/azure-functions/functions-reference-python)
- [Azure Cosmos DB Python SDK](https://docs.microsoft.com/azure/cosmos-db/sql/sql-api-sdk-python)
- [Azure Key Vault Python SDK](https://docs.microsoft.com/python/api/overview/azure/keyvault-secrets-readme)
- [PyJWT Documentation](https://pyjwt.readthedocs.io/)

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Test locally
4. Deploy to staging (optional)
5. Create pull request

## 📄 License

Same as main Fypod project

---

**Questions?** Check [SETUP_GUIDE.md](../SETUP_GUIDE.md) atau [QUICKSTART.md](../QUICKSTART.md)
