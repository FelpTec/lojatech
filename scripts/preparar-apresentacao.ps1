# =====================================================================
# Prepara o ambiente para a apresentação (Windows PowerShell)
#   powershell -ExecutionPolicy Bypass -File scripts\preparar-apresentacao.ps1
#
# 1. Recria MySQL + MongoDB do zero e sobe a aplicação
# 2. Roda os 31 testes automatizados (prova que tudo funciona)
# 3. Recria os bancos de novo (os testes deixam vendas/clientes de teste)
# 4. Abre o navegador em http://localhost:3000
# Funciona sem internet, desde que as imagens Docker já tenham sido baixadas
# uma vez (rode este script com internet pelo menos uma vez antes do dia).
# =====================================================================
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }

function Subir-Limpo {
  docker compose down -v --remove-orphans | Out-Null
  docker compose up -d --build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir os containers.' }
  Write-Host -NoNewline 'Aguardando a aplicação'
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $s = Invoke-RestMethod -Uri 'http://localhost:3000/api/saude' -TimeoutSec 3
      if ($s.ok) {
        # MongoDB também precisa estar pronto (fichas instaladas)
        $mongo = docker compose ps mongo --format '{{.Status}}'
        if ($mongo -match 'healthy') { Write-Host ' pronto.'; return }
      }
    } catch { }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 2
  }
  throw 'A aplicação não respondeu a tempo. Veja: docker compose logs'
}

Passo 'Verificando o Docker'
docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'O Docker Desktop não está aberto.' }

if (-not (Test-Path 'node_modules')) { Passo 'Instalando dependências (npm install)'; npm install --no-audit --no-fund | Out-Null }

Passo 'Recriando MySQL + MongoDB e subindo a aplicação'
Subir-Limpo

Passo 'Rodando os testes automatizados'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Algum teste falhou: NÃO apresente sem investigar.' }

Passo 'Recriando os bancos limpos para a apresentação'
Subir-Limpo

$s = Invoke-RestMethod -Uri 'http://localhost:3000/api/saude'
Write-Host "`nTudo pronto. API conectada ao MySQL como $($s.conta_bd) (MySQL $($s.versao_mysql))." -ForegroundColor Green
Write-Host 'Logins: admin@lojatech.com / Admin@2026 · vendedor@lojatech.com / Vendedor@2026 · consulta@lojatech.com / Consulta@2026'
Start-Process 'http://localhost:3000'
