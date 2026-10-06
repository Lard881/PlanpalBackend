# Test Database Migration Script (PowerShell)
# Runs all migrations against TEST Supabase project using psql

Write-Host "🚀 Test Database Migration Script" -ForegroundColor Cyan
Write-Host "=" * 60

# Load .env file
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Check for test credentials
$testUrl = $env:TEST_SUPABASE_URL
$testKey = $env:TEST_SUPABASE_SERVICE_KEY

if (-not $testUrl -or -not $testKey) {
    Write-Host "❌ ERROR: Test Supabase credentials not found in .env" -ForegroundColor Red
    Write-Host "Required: TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY"
    exit 1
}

Write-Host "📍 Target: $testUrl" -ForegroundColor Yellow
Write-Host ""

# Extract database connection details from URL
# Format: https://[project-ref].supabase.co
$projectRef = ($testUrl -replace 'https://', '' -replace '.supabase.co', '')

Write-Host "⚠️  IMPORTANT: Supabase migrations via script require database password" -ForegroundColor Yellow
Write-Host ""
Write-Host "To run migrations, you have 2 options:" -ForegroundColor Cyan
Write-Host ""
Write-Host "OPTION A - Manual (Recommended):" -ForegroundColor Green
Write-Host "  1. Go to: https://supabase.com/dashboard/project/$projectRef" 
Write-Host "  2. Click 'SQL Editor' in sidebar"
Write-Host "  3. Click 'New Query'"
Write-Host "  4. Copy and paste each migration file:"
Write-Host ""

$migrations = @(
    "0001_types.sql",
    "0002_core_tables.sql",
    "0003_helper_functions.sql",
    "0004_rls_policies.sql", 
    "0005_triggers_functions.sql",
    "0006_search.sql",
    "0007_analytics.sql",
    "0008_pg_cron_reminders.sql",
    "0009_realtime.sql"
)

foreach ($i in 0..($migrations.Count - 1)) {
    $num = $i + 1
    $file = $migrations[$i]
    Write-Host "     $num. supabase\migrations\$file" -ForegroundColor White
}

Write-Host ""
Write-Host "  5. Click 'Run' for each one"
Write-Host "  6. Verify 'Success' message"
Write-Host ""
Write-Host "OPTION B - Automatic (Requires Supabase CLI):" -ForegroundColor Green
Write-Host "  1. Install: npm install -g supabase"
Write-Host "  2. Link project: supabase link --project-ref $projectRef"
Write-Host "  3. Push migrations: supabase db push"
Write-Host ""
Write-Host "=" * 60
Write-Host ""

$choice = Read-Host "Would you like me to open the SQL Editor in your browser? (Y/N)"

if ($choice -eq 'Y' -or $choice -eq 'y') {
    $url = "https://supabase.com/dashboard/project/$projectRef/editor"
    Start-Process $url
    Write-Host "✅ Opening SQL Editor..." -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Copy migrations from: supabase\migrations\" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "After migrations complete, run: npm test" -ForegroundColor Yellow
