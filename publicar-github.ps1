# publicar-github.ps1 — publica la oficina en GitHub y deja el repo listo
# para que Easypanel lo construya.
#
#   .\publicar-github.ps1
#
# Pide: usuario de GitHub, nombre del repo y un Personal Access Token.
# El token NO se escribe en la linea de comandos ni en el historial: se
# pasa por GIT_ASKPASS, que Git invoca solo cuando necesita credenciales.

param(
  [string]$Usuario = '',
  [string]$Repo = 'virtual-agent-office',
  [string]$Remoto = 'origin',
  [switch]$Privado,
  [string]$Rama = 'main'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $raiz

function Die($m) { Write-Host "`n  x $m`n" -ForegroundColor Red; exit 1 }

# ── 1. El repo tiene que estar limpio ──────────────────────────
$pendientes = git status --porcelain
if ($pendientes) {
  Die "Hay cambios sin commitear. Commitea antes de publicar."
}
Write-Host "  ok  el arbol esta limpio" -ForegroundColor DarkGray

# ── 2. Identidad de git (local al repo) ─────────────────────────
if (-not $Usuario) {
  $Usuario = Read-Host "  Tu usuario de GitHub"
}
if (-not $Usuario.Trim()) { Die "Falta el usuario de GitHub" }

$nombre = Read-Host "  Tu nombre para los commits (por defecto: $Usuario)"
if (-not $nombre.Trim()) { $nombre = $Usuario }
$email = Read-Host "  Tu email de GitHub"
if (-not $email.Trim()) { $email = "$Usuario@users.noreply.github.com" }

git config user.name "$nombre"
git config user.email "$email"
Write-Host "  ok  identidad: $nombre <$email>" -ForegroundColor DarkGray

# ── 3. El token ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  Crea un token en: https://github.com/settings/tokens" -ForegroundColor Yellow
Write-Host "  (fine-grained, con permiso de escritura sobre repos)" -ForegroundColor DarkGray
$token = Read-Host "  Personal Access Token" -AsSecureString
$plano = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token))
if (-not $plain.Trim()) { Die "Falta el token" }

# El askpass solo existe durante este push.
$askpass = Join-Path $env:TEMP ("git-askpass-" + [guid]::NewGuid().ToString('N') + '.cmd')
@"
@echo off
if "%1"=="Username" echo $Usuario
if "%1"=="Password" echo $plain
"@ | Set-Content -Path $askpass -Encoding ASCII

$env:GIT_ASKPASS = $askpass
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

try {
  # ── 4. El remoto ────────────────────────────────────────────
  $url = "https://github.com/$Usuario/$Repo.git"
  $actual = git remote get-url $Remoto 2>$null
  if ($actual) {
    Write-Host "  ok  remoto $Remoto ya existe ($actual)" -ForegroundColor DarkGray
  } else {
    git remote add $Remoto $url
    Write-Host "  ok  remoto $Remoto -> $url" -ForegroundColor DarkGray
  }

  # ── 5. El push ───────────────────────────────────────────────
  Write-Host ""
  Write-Host "  Publicando en $Usuario/$Repo (rama $Rama)..." -ForegroundColor Cyan
  git push -u $Remoto $Rama
  if ($LASTEXITCODE -ne 0) { Die "El push fallo. Revisa el usuario, el token y que el repo exista." }

  Write-Host ""
  Write-Host "  ok  publicado: https://github.com/$Usuario/$Repo" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Siguiente paso en Easypanel:" -ForegroundColor White
  Write-Host "    1. Crea el repo en github.com$([char]47)$Repo ANTES de este push si no existe."
  Write-Host "       (o da error 'repository not found' arriba)"
  Write-Host "    2. New Service -> App -> nombre 'office'"
  Write-Host "    3. Source -> GitHub -> $Usuario/$Repo, rama $Rama, Build Path '/'"
  Write-Host "    4. Build -> Dockerfile"
  Write-Host "    5. Environment:"
  Write-Host "         AGENT_OFFICE_API_TOKEN=<token de 64 hex>"
  Write-Host "         AGENT_OFFICE_HOST=0.0.0.0"
  Write-Host "         AGENT_OFFICE_PORT=3334"
  Write-Host "         AGENT_OFFICE_PUBLIC_URL=https://`$(PRIMARY_DOMAIN)"
  Write-Host "         AGENT_OFFICE_HOME=/data"
  Write-Host "    6. Storage -> Volume -> /data"
  Write-Host "    7. Domain -> el automatico, target port 3334"
  Write-Host "    8. Deploy"
  Write-Host ""
  if ($Privado) {
    Write-Host "  Repo PRIVADO: Easypanel necesita un token de GitHub" -ForegroundColor Yellow
    Write-Host "  (Settings -> GitHub token) para poder clonarlo." -ForegroundColor Yellow
  } else {
    Write-Host "  Repo publico: Easypanel lo clona sin token." -ForegroundColor DarkGray
  }
}
finally {
  Remove-Item -Path $askpass -Force -ErrorAction SilentlyContinue
  $env:GIT_ASKPASS = ''
  $env:GIT_TERMINAL_PROMPT = ''
  $plain = $null
}
