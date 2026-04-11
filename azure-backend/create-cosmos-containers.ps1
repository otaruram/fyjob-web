# ─────────────────────────────────────────────────────
# FYJOB: Create Cosmos DB Containers
# Run this script after logging in with: az login
# ─────────────────────────────────────────────────────

# Variables — update these to match your Azure setup
$RESOURCE_GROUP = "FYPOD"
$ACCOUNT_NAME = "fypod"   # Cosmos DB account name
$DATABASE_NAME = "FypodDB"

# Check if logged in
Write-Host "Checking Azure CLI login status..." -ForegroundColor Cyan
try {
    az account show | Out-Null
} catch {
    Write-Host "Not logged in. Running 'az login'..." -ForegroundColor Yellow
    az login
}

Write-Host "`n=== Creating Cosmos DB Containers ===" -ForegroundColor Green

# 1. UjangChats container (partition key: /userId)
Write-Host "`n[1/3] Creating 'UjangChats' container..." -ForegroundColor Yellow
az cosmosdb sql container create `
    --resource-group $RESOURCE_GROUP `
    --account-name $ACCOUNT_NAME `
    --database-name $DATABASE_NAME `
    --name "UjangChats" `
    --partition-key-path "/userId"

# 2. UserActivity container (partition key: /userId)
Write-Host "`n[2/3] Creating 'UserActivity' container..." -ForegroundColor Yellow
az cosmosdb sql container create `
    --resource-group $RESOURCE_GROUP `
    --account-name $ACCOUNT_NAME `
    --database-name $DATABASE_NAME `
    --name "UserActivity" `
    --partition-key-path "/userId"

# 3. InterviewSessions container (partition key: /userId)
Write-Host "`n[3/3] Creating 'InterviewSessions' container..." -ForegroundColor Yellow
az cosmosdb sql container create `
    --resource-group $RESOURCE_GROUP `
    --account-name $ACCOUNT_NAME `
    --database-name $DATABASE_NAME `
    --name "InterviewSessions" `
    --partition-key-path "/userId"

Write-Host "`n=== All containers created! ===" -ForegroundColor Green
Write-Host "Database: $DATABASE_NAME" -ForegroundColor Cyan
Write-Host "Containers:" -ForegroundColor Cyan
Write-Host "  - Users (existing, partition: /id)" -ForegroundColor White
Write-Host "  - AnalysisHistory (existing, partition: /userId)" -ForegroundColor White
Write-Host "  - UjangChats (NEW, partition: /userId)" -ForegroundColor Green
Write-Host "  - UserActivity (NEW, partition: /userId)" -ForegroundColor Green
Write-Host "  - InterviewSessions (NEW, partition: /userId)" -ForegroundColor Green
