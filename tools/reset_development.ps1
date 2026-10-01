[CmdletBinding()]
param(
    [switch]$ConfirmDevelopmentReset
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not $ConfirmDevelopmentReset) {
    throw 'This deletes development data. Re-run with -ConfirmDevelopmentReset after checking deploy/.env.'
}

function Read-DotEnvFile([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $values
}

$DeployEnv = Read-DotEnvFile (Join-Path $ProjectRoot 'deploy/.env')
$BindAddress = if ($DeployEnv.ContainsKey('BIND_ADDRESS')) { $DeployEnv['BIND_ADDRESS'] } else { '127.0.0.1' }
$AllowedHosts = if ($DeployEnv.ContainsKey('DJANGO_ALLOWED_HOSTS')) { $DeployEnv['DJANGO_ALLOWED_HOSTS'].Split(',') } else { @('localhost', '127.0.0.1') }
$NonLocalHosts = @($AllowedHosts | Where-Object { $_.Trim() -notin @('localhost', '127.0.0.1') })
if ($BindAddress -ne '127.0.0.1' -or
    $DeployEnv['POSTGRES_DB'] -ne 'inventory' -or
    $NonLocalHosts.Count -gt 0) {
    throw 'Refusing reset: deploy/.env is not restricted to the local development database and loopback hosts.'
}

function Test-LocalPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

$EdgePorts = @(8000, 8002)
$ActiveEdgePorts = @($EdgePorts | Where-Object { Test-LocalPort $_ })
if ($ActiveEdgePorts.Count -gt 0) {
    throw "Stop IPC/IPCSIM first; local edge API port(s) still active: $($ActiveEdgePorts -join ', ')."
}

$ComposeBase = @('--env-file', 'deploy/.env', '-f', 'deploy/compose.yaml')
function Invoke-Compose([string[]]$Arguments) {
    & docker compose @ComposeBase @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($Arguments -join ' ')"
    }
}

$ProjectPrefix = $ProjectRoot.TrimEnd('\') + '\'
$LocalDatabases = @()
$EdgeConfigs = @(
    [pscustomobject]@{ EnvFile = 'IPCSIM/.env'; DeviceId = 'IPCSIM01'; DeviceType = 'IPCSIM' },
    [pscustomobject]@{ EnvFile = 'IPC/.env'; DeviceId = 'IPC01'; DeviceType = 'IPC' }
)
foreach ($edge in $EdgeConfigs) {
    $envPath = Join-Path $ProjectRoot $edge.EnvFile
    if (-not (Test-Path -LiteralPath $envPath)) {
        if ($edge.DeviceType -eq 'IPCSIM') {
            throw 'IPCSIM/.env is required before reset.'
        }
        continue
    }
    $edgeEnv = Read-DotEnvFile $envPath
    if ($edgeEnv['DEVICE_ID'] -ne $edge.DeviceId -or $edgeEnv['DEVICE_TYPE'] -ne $edge.DeviceType -or -not $edgeEnv['DB_PATH']) {
        throw "$($edge.EnvFile) must use DEVICE_ID=$($edge.DeviceId), DEVICE_TYPE=$($edge.DeviceType), and define DB_PATH."
    }
    $databasePath = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $envPath) $edgeEnv['DB_PATH']))
    if (-not $databasePath.StartsWith($ProjectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing reset: $($edge.EnvFile) DB_PATH resolves outside the workspace."
    }
    $LocalDatabases += $databasePath
}
$LocalDatabases += @(
    (Join-Path $ProjectRoot 'IPCSIM/runtime/IPCSIM.sqlite3'),
    (Join-Path $ProjectRoot 'IPCSIM/data/ipc_db.sqlite'),
    (Join-Path $ProjectRoot 'IPCSIM/data/ipc.db'),
    (Join-Path $ProjectRoot 'IPC/runtime/IPC01.sqlite3'),
    (Join-Path $ProjectRoot 'IPC/runtime/physical-edge.sqlite3')
)
$LocalDatabases = @($LocalDatabases | Select-Object -Unique)
foreach ($databasePath in $LocalDatabases) {
    $fullPath = [System.IO.Path]::GetFullPath($databasePath)
    if (-not $fullPath.StartsWith($ProjectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove a local database outside the workspace.'
    }
}

$PasswordFile = Join-Path $ProjectRoot 'deploy/secrets/passwords'
if (-not (Test-Path -LiteralPath $PasswordFile)) {
    throw 'Missing deploy/secrets/passwords; refusing to reset without the broker credentials file.'
}
$PasswordLines = @(Get-Content -LiteralPath $PasswordFile)
$OldMqttUser = @($PasswordLines | Where-Object { $_.StartsWith('IPCSIM:') })
$NewMqttUser = @($PasswordLines | Where-Object { $_.StartsWith('IPCSIM01:') })
if (($OldMqttUser.Count -eq 1 -and $NewMqttUser.Count -eq 0) -or ($OldMqttUser.Count -eq 0 -and $NewMqttUser.Count -eq 1)) {
    $RenameMqttUser = $OldMqttUser.Count -eq 1
}
else {
    throw 'Expected exactly one IPCSIM or IPCSIM01 MQTT account; resolve credentials manually before reset.'
}

Invoke-Compose @('build', 'server', 'worker', 'web', 'migrate')
Invoke-Compose @('up', '-d', 'postgres', 'mqtt')
Invoke-Compose @('stop', 'worker', 'server', 'web')

foreach ($fullPath in $LocalDatabases) {
    foreach ($path in @($fullPath, "$fullPath-wal", "$fullPath-shm")) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }
}

if ($RenameMqttUser) {
    $PasswordLines = @($PasswordLines | ForEach-Object { $_ -replace '^IPCSIM:', 'IPCSIM01:' })
    [System.IO.File]::WriteAllLines($PasswordFile, $PasswordLines, [System.Text.Encoding]::ASCII)
}

Invoke-Compose @('run', '--rm', '--no-deps', '-e', 'ALLOW_DEVELOPMENT_DATA_RESET=1', 'server', 'python', 'Server/manage.py', 'reset_development', '--confirm-development-reset')
Invoke-Compose @('run', '--rm', '--no-deps', 'migrate')
Invoke-Compose @('run', '--rm', '--no-deps', '-e', 'DJANGO_DEBUG=1', 'server', 'python', 'Server/manage.py', 'seed_demo_data', '--allow-demo', '--queue-sync')
Invoke-Compose @('restart', 'mqtt')
Invoke-Compose @('up', '-d', 'server', 'worker', 'web')
Write-Host 'Development databases reset, baseline migrated, demo seed loaded, and Compose services restarted.'
Write-Host 'Create a Server login with: docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser'