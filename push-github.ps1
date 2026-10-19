# push-github.ps1 — publica la oficina en GitHub.
#
#   .\push-github.ps1
#
# Pide un Personal Access Token y lo hace push. El token NO se escribe en
# la linea de comandos ni en el historial: se pasa por GIT_ASKPASS, que Git
# invoca solo cuando necesita credenciales.
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
$token = Read-Host "  Personal Access Token" -AsSecureString
$plano = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token))
if (-not $plano.Trim()) { Die "Falta el token" }

# El askpass solo existe durante este push.
$askpass = Join-Path $env:TEMP ("git-askpass-" + [guid]::NewGuid().ToString('N') + '.cmd')
@"
@echo off
if "%1"=="Username" echo $Usuario
if "%1"=="Password" echo $plano
"@ | Set-Content -Path $askpass -Encoding ASCII

$env:GIT_ASKPASS = $askpass
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

try {
  Write-Host ""
  Write-Host "  Publicando..." -ForegroundColor Cyan
  git push -u origin $Rama
  if ($LASTEXITCODE -ne 0) {
    Die @"
El push fallo. Comprueba:
  - que el token tenga permiso de escritura sobre el repo
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
  Remove-Item -Path $askpass -Force -ErrorAction SilentlyContinue
  $env:GIT_ASKPASS = ''
  $env:GIT_TERMINAL_PROMPT = ''
  $plano = $null
}
