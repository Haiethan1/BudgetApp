#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*$')][string]$NasHost,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_][A-Za-z0-9_.-]*$')][string]$Username,
    [Parameter(Mandatory = $true)][ValidatePattern('^/')][string]$ComposeDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationDirectory,
    [ValidateRange(1, 65535)][int]$SshPort = 22,
    [string]$SshConfigPath,
    [string]$GpgPath = 'gpg.exe',
    [System.Security.SecureString]$Passphrase
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this helper in Windows PowerShell 5.1 or PowerShell 7 on Windows.' }

function Quote-Posix([string]$Value) { return "'" + $Value.Replace("'", "'\''") + "'" }
function Quote-Native([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-External([string]$Executable, [string[]]$Arguments, [string]$InputText = $null) {
    $hasInput = $PSBoundParameters.ContainsKey('InputText')
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = ($Arguments | ForEach-Object { Quote-Native $_ }) -join ' '
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $hasInput
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw "Could not start $Executable." }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if ($hasInput) {
            $inputBytes = [Text.Encoding]::UTF8.GetBytes($InputText)
            $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
            $process.StandardInput.Close()
        }
        $process.WaitForExit()
        $output = $stdout.GetAwaiter().GetResult()
        $diagnostic = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "$Executable failed with exit code $($process.ExitCode). $diagnostic" }
        return $output.Trim()
    } finally { $process.Dispose() }
}
function Invoke-Nas([string]$Script) {
    $Script = $Script.Replace("`r`n", "`n")
    return Invoke-External $script:Ssh ($script:SshConfigArguments + @('-T', '-p', [string]$SshPort, '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '--', "$Username@$NasHost", 'sh', '-s')) ($Script + "`n")
}
function Protect-Staging([string]$Directory) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    foreach ($sid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'))) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Directory -AclObject $acl
}
function Test-SecretEqual([System.Security.SecureString]$First, [System.Security.SecureString]$Second) {
    $firstPointer = [IntPtr]::Zero
    $secondPointer = [IntPtr]::Zero
    try {
        if ($First.Length -ne $Second.Length) { return $false }
        $firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($First)
        $secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Second)
        $difference = 0
        for ($index = 0; $index -lt $First.Length; $index++) {
            $difference = $difference -bor ([Runtime.InteropServices.Marshal]::ReadInt16($firstPointer, 2 * $index) -bxor [Runtime.InteropServices.Marshal]::ReadInt16($secondPointer, 2 * $index))
        }
        return $difference -eq 0
    } finally {
        if ($firstPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer) }
        if ($secondPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer) }
    }
}
function Invoke-Gpg([string[]]$Arguments, [System.Security.SecureString]$Secret) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $script:Gpg
    $info.Arguments = (@('--batch', '--pinentry-mode', 'loopback', '--passphrase-fd', '0') + $Arguments | ForEach-Object { Quote-Native $_ }) -join ' '
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    $pointer = [IntPtr]::Zero
    $bytes = $null
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($value.IndexOfAny([char[]]"`r`n") -ge 0) { throw 'Use a single-line encryption passphrase.' }
        if (-not $process.Start()) { throw 'Could not start GPG.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $bytes = [Text.Encoding]::UTF8.GetBytes($value + "`n")
        $value = $null
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.Close()
        $process.WaitForExit()
        $null = $stdout.GetAwaiter().GetResult()
        $diagnostic = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "GPG failed with exit code $($process.ExitCode). $diagnostic" }
    } finally {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $process.Dispose()
    }
}

$script:Ssh = (Get-Command ssh.exe -CommandType Application -ErrorAction Stop).Source
$scp = (Get-Command scp.exe -CommandType Application -ErrorAction Stop).Source
$tar = (Get-Command tar.exe -CommandType Application -ErrorAction Stop).Source
$script:Gpg = (Get-Command $GpgPath -CommandType Application -ErrorAction Stop).Source
$script:SshConfigArguments = @()
if ($SshConfigPath) {
    $config = (Resolve-Path -LiteralPath $SshConfigPath).Path
    $script:SshConfigArguments = @('-F', $config)
}
$destination = [IO.Path]::GetFullPath($DestinationDirectory)
if (-not (Test-Path -LiteralPath $destination)) { New-Item -ItemType Directory -Path $destination | Out-Null }
if (-not (Test-Path -LiteralPath $destination -PathType Container)) { throw 'Choose an archive directory.' }
$run = [Guid]::NewGuid().ToString('N')
$ownership = [Guid]::NewGuid().ToString('N')
$name = 'homebooks-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + $run + '.tar.gpg'
$archive = Join-Path $destination $name
$receipt = $archive + '.json'
if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $receipt)) { throw 'The generated archive name already exists.' }
$stagingRoot = Join-Path $env:LOCALAPPDATA 'Homebooks\backup-staging'
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
$staging = Join-Path $stagingRoot $run
New-Item -ItemType Directory -Path $staging | Out-Null
Protect-Staging $staging
$download = Join-Path $staging 'bundle.tar'
$encrypted = Join-Path $staging 'bundle.tar.gpg'
$decrypted = Join-Path $staging 'verified.tar'
$secret = $null
$metadata = $null
$encryptionCompleted = $false
$published = $false
$remoteStarted = $false

$prepare = @'
set -eu
umask 077
cd __COMPOSE__
run=__RUN__
container="$(docker compose ps -q app)"
case "$container" in ''|*[!0-9a-f]*) echo 'Expected one app container.' >&2; exit 1;; esac
[ "${#container}" = 64 ] || { echo 'Expected a full container ID.' >&2; exit 1; }
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]
image="$(docker inspect --format '{{.Image}}' "$container")"
stage="$HOME/.cache/homebooks-pull-$run"
[ ! -e "$stage" ]
mkdir -p "$HOME/.cache"
mkdir -m 700 "$stage"
printf '%s\n' __OWNERSHIP__ > "$stage/ownership"
printf '%s\n' "$container" > "$stage/container-id"
source="$(docker exec "$container" node operations/backup.mjs create | tr -d '\r')"
docker exec "$container" node -e 'if(!/^\/backups\/manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(process.argv[1]))throw Error("Unexpected snapshot path")' "$source"
printf '%s\n' "$source" > "$stage/snapshot-dir"
export_dir="/backups/windows-pull-$run"
docker exec "$container" node operations/backup.mjs validate "$source" >&2
docker exec "$container" node operations/backup.mjs export "$source" "$export_dir" >&2
printf '%s\n' 'true' > "$stage/export-owned"
docker exec "$container" node operations/backup.mjs validate "$export_dir" >&2
set -C
( printf '%s\n' 'true' > "$stage/archive-owned"; docker exec "$container" tar -C "$export_dir" -cf - database.sqlite manifest.json ) > "$stage/bundle.tar"
docker exec -i "$container" node -e 'const f=require("node:fs"),c=require("node:crypto"),p=require("node:path"),h=c.createHash("sha256");const [source,remoteArchive,container,image]=process.argv.slice(1);process.stdin.on("data",b=>h.update(b));process.stdin.on("error",e=>{console.error(e.message);process.exitCode=1});process.stdin.on("end",()=>{const m=JSON.parse(f.readFileSync(p.join(source,"manifest.json"),"utf8"));console.log(JSON.stringify({snapshotDirectory:source,createdAt:m.createdAt,archiveSha256:h.digest("hex"),remoteArchive,containerId:container,imageId:image}))});' "$source" "$stage/bundle.tar" "$container" "$image" < "$stage/bundle.tar"
'@
$prepare = $prepare.Replace('__COMPOSE__', (Quote-Posix $ComposeDirectory)).Replace('__RUN__', (Quote-Posix $run)).Replace('__OWNERSHIP__', (Quote-Posix $ownership))
$cleanup = @'
set -eu
run=__RUN__
stage="$HOME/.cache/homebooks-pull-$run"
[ -d "$stage" ] || exit 0
[ -f "$stage/ownership" ] && [ "$(cat "$stage/ownership")" = __OWNERSHIP__ ] || { echo 'Staging ownership is unproven; preserving it.' >&2; exit 1; }
container="$(cat "$stage/container-id")"
case "$container" in ''|*[!0-9a-f]*) echo 'Invalid recorded container ID.' >&2; exit 1;; esac
[ "${#container}" = 64 ]
source=''
if [ -f "$stage/snapshot-dir" ]; then source="$(cat "$stage/snapshot-dir")"; fi
export_owned=false
if [ -f "$stage/export-owned" ] && [ "$(cat "$stage/export-owned")" = true ]; then export_owned=true; fi
if [ __REMOVE_SOURCE__ = true ] && [ -n "$source" ]; then docker exec "$container" node operations/backup.mjs validate "$source" >&2; fi
docker exec "$container" node -e 'const f=require("node:fs"),p=require("node:path");const [run,source,remove,exportOwned]=process.argv.slice(1);if(!/^[a-f0-9]{32}$/.test(run))throw Error("Invalid run ID");const dirs=exportOwned==="true"?["/backups/windows-pull-"+run]:[];if(remove==="true"&&source){if(!/^\/backups\/manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(source))throw Error("Unexpected snapshot path");dirs.push(source)}for(const dir of dirs){if(!f.existsSync(dir))continue;if(p.dirname(f.realpathSync(dir))!==f.realpathSync("/backups"))throw Error("Bundle moved outside backup root");if(JSON.stringify(f.readdirSync(dir).sort())!==JSON.stringify(["database.sqlite","manifest.json"]))throw Error("Unexpected bundle contents");for(const name of ["database.sqlite","manifest.json"])f.unlinkSync(p.join(dir,name));f.rmdirSync(dir)}' "$run" "$source" __REMOVE_SOURCE__ "$export_owned"
if [ -f "$stage/archive-owned" ] && [ "$(cat "$stage/archive-owned")" = true ]; then rm -f -- "$stage/bundle.tar"; fi
rm -f -- "$stage/snapshot-dir" "$stage/container-id" "$stage/export-owned" "$stage/archive-owned" "$stage/ownership"
rmdir -- "$stage"
'@
try {
    if ($null -ne $Passphrase) { $secret = $Passphrase.Copy() }
    else {
        $secret = Read-Host 'Encryption passphrase, stored separately from the backups' -AsSecureString
        $confirmation = Read-Host 'Confirm encryption passphrase' -AsSecureString
        try { if (-not (Test-SecretEqual $secret $confirmation)) { throw 'Passphrases do not match. No NAS snapshot was created.' } }
        finally { $confirmation.Dispose() }
    }
    if ($secret.Length -eq 0) { throw 'Use a nonempty encryption passphrase.' }
    Write-Host 'Creating a validated NAS snapshot. SSH uses the previously trusted host key.'
    $remoteStarted = $true
    $metadata = Invoke-Nas $prepare | ConvertFrom-Json
    if ($metadata.containerId -notmatch '^[a-f0-9]{64}$' -or $metadata.imageId -notmatch '^sha256:[a-f0-9]{64}$' -or $metadata.archiveSha256 -notmatch '^[a-f0-9]{64}$') { throw 'The NAS returned invalid backup metadata.' }
    if ($metadata.snapshotDirectory -notmatch '^/backups/manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$') { throw 'The NAS returned an unexpected snapshot path.' }
    if ($metadata.remoteArchive -notmatch ('^/[A-Za-z0-9_./-]+/homebooks-pull-' + $run + '/bundle\.tar$')) { throw 'The NAS staging path must be an absolute path without spaces or shell characters.' }
    $null = Invoke-External $scp ($script:SshConfigArguments + @('-q', '-P', [string]$SshPort, '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '--', ($Username + '@' + $NasHost + ':' + $metadata.remoteArchive), $download))
    $tarHash = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($tarHash -ne $metadata.archiveSha256) { throw 'The downloaded archive differs from the validated NAS copy.' }
    Write-Host 'Encrypting and verifying the downloaded copy.'
    Invoke-Gpg @('--cipher-algo', 'AES256', '--output', $encrypted, '--symmetric', $download) $secret
    $encryptionCompleted = $true
    Invoke-Gpg @('--output', $decrypted, '--decrypt', $encrypted) $secret
    if ((Get-FileHash -LiteralPath $decrypted -Algorithm SHA256).Hash.ToLowerInvariant() -ne $tarHash) { throw 'The decrypted archive does not match the validated source.' }
    $members = (Invoke-External $tar @('-tf', $decrypted)).Split("`n") | ForEach-Object { $_.Trim() }
    if (($members | Sort-Object) -join ',' -ne 'database.sqlite,manifest.json') { throw 'The archive must contain only database.sqlite and manifest.json.' }
    $encryptedHash = (Get-FileHash -LiteralPath $encrypted -Algorithm SHA256).Hash.ToLowerInvariant()
    Move-Item -LiteralPath $encrypted -Destination $archive
    $record = [ordered]@{ format = 1; application = 'homebooks'; verifiedAt = [DateTime]::UtcNow.ToString('o'); archive = $name;
        encryptedSha256 = $encryptedHash; sourceArchiveSha256 = $tarHash; snapshotCreatedAt = $metadata.createdAt;
        imageId = $metadata.imageId; containerId = $metadata.containerId; nasHost = $NasHost; verified = $true }
    $stream = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $recordBytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json)); $stream.Write($recordBytes, 0, $recordBytes.Length) }
    finally { $stream.Dispose() }
    $published = $true
    Write-Host "Verified encrypted backup: $archive"
    Write-Host "Verification receipt: $receipt"
} finally {
    if ($remoteStarted) {
        try { $null = Invoke-Nas ($cleanup.Replace('__RUN__', (Quote-Posix $run)).Replace('__OWNERSHIP__', (Quote-Posix $ownership)).Replace('__REMOVE_SOURCE__', $(if ($published) { 'true' } else { 'false' }))) }
        catch { Write-Warning "NAS cleanup failed. Preserve the local archive and inspect only this run's /backups/windows-pull-$run files and ~/.cache/homebooks-pull-$run. $($_.Exception.Message)" }
    }
    foreach ($file in @($download, $decrypted)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    if (-not $encryptionCompleted -and (Test-Path -LiteralPath $encrypted)) { Remove-Item -LiteralPath $encrypted -Force }
    if (Test-Path -LiteralPath $encrypted) { Write-Warning "Unverified encrypted candidate retained in restricted staging: $encrypted" }
    elseif ((Get-ChildItem -LiteralPath $staging -Force | Measure-Object).Count -eq 0) { Remove-Item -LiteralPath $staging -Force }
    if (-not $published -and $null -ne $metadata) { Write-Warning "No verified receipt was published. The NAS source snapshot remains at $($metadata.snapshotDirectory)." }
    if ($null -ne $secret) { $secret.Dispose() }
}
