# ─────────────────────────────────────────────────────
# FYJOB: Create Cosmos DB Containers
# Run this script after logging in with: az login
# ─────────────────────────────────────────────────────

# Variables — update these to match your Azure setup
$RESOURCE_GROUP = "fypodku"
$ACCOUNT_NAME = "fypodku-cosmosdb"   # Your Cosmos DB account name
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
Write-Host "`n[1/2] Creating 'UjangChats' container..." -ForegroundColor Yellow
az cosmosdb sql container create `
    --resource-group $RESOURCE_GROUP `
    --account-name $ACCOUNT_NAME `
    --database-name $DATABASE_NAME `
    --name "UjangChats" `
    --partition-key-path "/userId" `
    --throughput 400

# 2. UserActivity container (partition key: /userId)
Write-Host "`n[2/2] Creating 'UserActivity' container..." -ForegroundColor Yellow
az cosmosdb sql container create `
    --resource-group $RESOURCE_GROUP `
    --account-name $ACCOUNT_NAME `
    --database-name $DATABASE_NAME `
    --name "UserActivity" `
    --partition-key-path "/userId" `
    --throughput 400

Write-Host "`n=== All containers created! ===" -ForegroundColor Green
Write-Host "Database: $DATABASE_NAME" -ForegroundColor Cyan
Write-Host "Containers:" -ForegroundColor Cyan
Write-Host "  - Users (existing, partition: /id)" -ForegroundColor White
Write-Host "  - AnalysisHistory (existing, partition: /userId)" -ForegroundColor White
Write-Host "  - UjangChats (NEW, partition: /userId)" -ForegroundColor Green
Write-Host "  - UserActivity (NEW, partition: /userId)" -ForegroundColor Green
