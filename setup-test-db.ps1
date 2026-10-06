# Setup Test Database - Automated Migration Script
# This script will install Supabase CLI and run migrations automatically

Write-Host "`n🚀 PlanPal Test Database Setup" -ForegroundColor Cyan
Write-Host "=" * 70

# Check if Supabase CLI is installed
$supabaseCli = Get-Command supabase -ErrorAction SilentlyContinue

if (-not $supabaseCli) {
    Write-Host "`n❌ Supabase CLI not found" -ForegroundColor Yellow
    Write-Host "📦 Installing Supabase CLI via npm..." -ForegroundColor Cyan
    
    npm install -g supabase
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ Failed to install Supabase CLI" -ForegroundColor Red
        Write-Host "💡 Try manually: npm install -g supabase" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "✅ Supabase CLI installed" -ForegroundColor Green
}

# Load .env to get project ref
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*TEST_SUPABASE_URL\s*=\s*https://([^.]+)\.supabase\.co') {
            $projectRef = $matches[1]
            [Environment]::SetEnvironmentVariable("TEST_PROJECT_REF", $projectRef, "Process")
        }
    }
}

$projectRef = $env:TEST_PROJECT_REF

if (-not $projectRef) {
    Write-Host "`n❌ Could not find TEST_SUPABASE_URL in .env" -ForegroundColor Red
    exit 1
}

Write-Host "`n📍 Test Project: $projectRef" -ForegroundColor Yellow
Write-Host "`n🔗 Linking to test project..." -ForegroundColor Cyan

# Link to test project
supabase link --project-ref $projectRef

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Failed to link project" -ForegroundColor Red
    Write-Host "💡 You may need to login first: supabase login" -ForegroundColor Yellow
    
    $login = Read-Host "`nWould you like to login now? (Y/N)"
    if ($login -eq 'Y' -or $login -eq 'y') {
        supabase login
        supabase link --project-ref $projectRef
    } else {
        exit 1
    }
}

Write-Host "`n✅ Project linked" -ForegroundColor Green

Write-Host "`n📤 Pushing migrations to test database..." -ForegroundColor Cyan
Write-Host "   This will run all 9 migration files..." -ForegroundColor Gray

# Push migrations
supabase db push --db-url "postgresql://postgres:[YOUR-PASSWORD]@db.$projectRef.supabase.co:5432/postgres"

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n" + ("=" * 70)
    Write-Host "✅ SUCCESS! Test database is ready" -ForegroundColor Green
    Write-Host "`n📊 Migrations completed:" -ForegroundColor Cyan
    Write-Host "   - All tables created"
    Write-Host "   - RLS policies enabled"
    Write-Host "   - Triggers installed"
    Write-Host "   - Functions deployed"
    Write-Host "`n🧪 Next step: Run tests" -ForegroundColor Yellow
    Write-Host "   npm test" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "`n❌ Migration failed" -ForegroundColor Red
    Write-Host "💡 See manual instructions below" -ForegroundColor Yellow
}
