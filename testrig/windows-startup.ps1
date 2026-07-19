# GCP Windows startup script: dev toolchain + key-based OpenSSH.
#
# Passed to `gcloud compute instances create` as windows-startup-script-ps1
# (see vm.sh create). It runs on every boot, so everything here is idempotent.
#
# Before using: replace $PublicKey below with YOUR ssh public key. There is no
# password login to this box — the key is the only way in.
$ErrorActionPreference = "Continue"
Start-Transcript -Path C:\dota-startup.log -Append

$PublicKey = "ssh-ed25519 AAAA_REPLACE_ME_WITH_YOUR_PUBLIC_KEY dota-vm-builder"

# --- Chocolatey + git + node ---
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  [System.Net.ServicePointManager]::SecurityProtocol = 3072
  Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  $env:Path = "$env:Path;C:\ProgramData\chocolatey\bin"
}
choco install -y git nodejs-lts

# --- 'builder' admin user: the key-auth target ---
# The password is random and immediately discarded. Nobody logs in with it;
# Windows just refuses to create an account without one.
$pw = ConvertTo-SecureString ("Dota!" + [guid]::NewGuid().ToString("N")) -AsPlainText -Force
if (-not (Get-LocalUser -Name builder -ErrorAction SilentlyContinue)) {
  New-LocalUser -Name builder -Password $pw -PasswordNeverExpires -AccountNeverExpires
}
Add-LocalGroupMember -Group Administrators -Member builder -ErrorAction SilentlyContinue

# --- OpenSSH Server ---
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic
Start-Service sshd
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound `
  -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue

# PowerShell as the default shell, so non-interactive `ssh host "<command>"`
# gets PowerShell semantics instead of cmd.exe.
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force -ErrorAction SilentlyContinue

# --- inject the public key ---
# Members of Administrators do NOT use ~/.ssh/authorized_keys on Windows
# OpenSSH; they use this one shared file, and it must have locked-down ACLs or
# sshd silently ignores it.
$akf = "C:\ProgramData\ssh\administrators_authorized_keys"
Set-Content -Path $akf -Value $PublicKey -Encoding ascii
icacls $akf /inheritance:r
icacls $akf /grant "Administrators:F" "SYSTEM:F"

Stop-Transcript
