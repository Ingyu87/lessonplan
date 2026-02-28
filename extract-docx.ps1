$docxPath = Join-Path $PSScriptRoot "장학자료.docx"
$outPath = Join-Path $PSScriptRoot "장학자료_extract.txt"
$zipPath = Join-Path $PSScriptRoot "장학자료_temp.zip"
Copy-Item -Path $docxPath -Destination $zipPath -Force
Expand-Archive -Path $zipPath -DestinationPath (Join-Path $PSScriptRoot "장학자료_temp") -Force
$xmlPath = Join-Path $PSScriptRoot "장학자료_temp\word\document.xml"
$xml = [xml](Get-Content -Path $xmlPath -Encoding UTF8)
$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
$nodes = $xml.SelectNodes("//w:t", $ns)
$text = ($nodes | ForEach-Object { $_.InnerText }) -join ""
$text = $text -replace '\s+', "`n"
$text | Set-Content -Path $outPath -Encoding UTF8
Remove-Item $zipPath -Force
Remove-Item (Join-Path $PSScriptRoot "장학자료_temp") -Recurse -Force
Write-Host "Done: $outPath"
