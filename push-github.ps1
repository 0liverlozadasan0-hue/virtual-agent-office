# push-github.ps1 — publica la oficina en GitHub.
#
#   .\push-github.ps1
#
# Pide un Personal Access Token y hace el push. El token NO se escribe en
# la linea de comandos, ni en un .cmd, ni en el historial: vive solo en la
# variable de entorno de este proceso y se lo pasa a git por GIT_ASKPASS.
#
# Repo: https://github.com/0liverlozadasan0-hue/virtual-agent-office

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $raiz

function Die($m) { Write-Host "`n  x $m`n" -ForegroundColor Red; exit 1 }

$Usuario = '0liverlozadasan0-hue'
$Repo    = 'virtual-agent-office'
$Rama    = 'main'

# ── 1. Nada sin commitear ──────────────────────────────────────
$pendientes = git status --porcelain
if ($pendientes) { Die "Hay cambios sin commitear. Commitea antes de publicar." }
Write-Host "  ok  el arbol esta limpio" -ForegroundColor DarkGray

# ── 2. El remoto ───────────────────────────────────────────────
$url = "https://github.com/$Usuario/$Repo.git"
$actual = git remote get-url origin 2>$null
if ($actual -ne $url) {
  if ($actual) { git remote set-url origin $url } else { git remote add origin $url }
}
Write-Host "  ok  remoto -> $url" -ForegroundColor DarkGray

# ── 3. El token ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  Crea un token (fine-grained) en:" -ForegroundColor Yellow
Write-Host "  https://github.com/settings/personal-access-tokens/new" -ForegroundColor Yellow
Write-Host "  Permisos: Repository access -> Only select repositories ->" -ForegroundColor DarkGray
Write-Host "  virtual-agent-office, y marca Read and write." -ForegroundColor DarkGray
Write-Host ""
$secreto = Read-Host "  Personal Access Token" -AsSecureString
$token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secreto))
if (-not $token.Trim()) { Die "Falta el token" }

# El token viaja en la variable de entorno, no en el texto de un .cmd:
# CMD no lo parsea nunca y un token con & | ^ < > no rompe nada.
$env:OFFICE_GIT_USER  = $Usuario
$env:OFFICE_GIT_TOKEN = $token.Trim()

# El askpass es un .cmd que NO contiene el token: solo llama a PowerShell,
# que lee la respuesta de la variable de entorno.
$dirTemporal = Join-Path $env:TEMP ("git-askpass-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $dirTemporal | Out-Null

$ps1 = Join-Path $dirTemporal 'askpass.ps1'
@'
param([string]$Prompt)
if ($Prompt -match 'Username') { Write-Output $env:OFFICE_GIT_USER }
else { Write-Output $env:OFFICE_GIT_TOKEN }
'@ | Set-Content -Path $ps1 -Encoding UTF8

$cmd = Join-Path $dirTemporal 'askpass.cmd'
@"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "$ps1" "%1"
"@ | Set-Content -Path $cmd -Encoding ASCII

$env:GIT_ASKPASS = $cmd
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

try {
  Write-Host ""
  Write-Host "  Publicando..." -ForegroundColor Cyan
  git push -u origin $Rama
  if ($LASTEXITCODE -ne 0) {
    Die @"
El push fallo. Comprueba:
  - que el token tenga permiso de escritura (Contents: Read and write)
  - que el repo seleccionado en el token sea $Usuario/$Repo
  - que hayas copiado el token entero, sin espacios
"@
  }

  Write-Host ""
  Write-Host "  ok  publicado: https://github.com/$Usuario/$Repo" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Ahora, en Easypanel:" -ForegroundColor White
  Write-Host "    1. New Service -> App -> nombre 'office'"
  Write-Host "    2. Source -> GitHub -> $Usuario/$Repo, rama $Rama, Build Path '/'"
  Write-Host "    3. Build -> Dockerfile"
  Write-Host "    4. Environment:"
  Write-Host "         AGENT_OFFICE_API_TOKEN=<token de 64 hex>   <- npm run token"
  Write-Host "         AGENT_OFFICE_HOST=0.0.0.0"
  Write-Host "         AGENT_OFFICE_PORT=3334"
  Write-Host "         AGENT_OFFICE_PUBLIC_URL=https://`$(PRIMARY_DOMAIN)"
  Write-Host "         AGENT_OFFICE_HOME=/data"
  Write-Host "    5. Storage -> Volume -> /data"
  Write-Host "    6. Domain -> el automatico, target port 3334"
  Write-Host "    7. Deploy"
  Write-Host ""
}
finally {
  Remove-Item -Path $dirTemporal -Recurse -Force -ErrorAction SilentlyContinue
  $env:GIT_ASKPASS = ''
  $env:GIT_TERMINAL_PROMPT = ''
  $env:OFFICE_GIT_USER = ''
  $env:OFFICE_GIT_TOKEN = ''
  $token = $null
}
