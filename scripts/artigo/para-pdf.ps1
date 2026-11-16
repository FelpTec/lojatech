# Converte o .docx em PDF usando o Microsoft Word instalado (Windows)
param([string]$Docx, [string]$Pdf)
# Aceita caminhos relativos: o Word (COM) exige caminho absoluto
$Docx = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Docx))
$Pdf = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Pdf))
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Docx, $false, $false)
  $doc.Repaginate()
  $doc.ExportAsFixedFormat($Pdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
  "paginas: " + $doc.ComputeStatistics(2)
  $doc.Close([ref]0)
} finally { $word.Quit() }
