# Headless playtest: cook the addon, launch Dota with the e2e convar engaged,
# watch it play, then read the console log and issue a verdict.
#
# MUST run inside the interactive console session (session 1). An SSH login
# lands in session 0, which has no display head, so the datacenter GPU never
# initializes a DX11 device and Dota dies on startup. Drive this file through a
# scheduled task registered with an Interactive principal — see README.md.
#
# The verdict comes from a MARKER CONTRACT: your game prints agreed-upon
# strings, and this script greps for them. Positive markers prove the thing
# happened; negative patterns prove nothing broke. Both halves are needed —
# "no errors" is not the same as "the game worked".

param(
  [string]$Dota        = "C:\steamcmd\steamapps\common\dota 2 beta",
  [string]$Addon       = "hello_arena",
  [string]$Map         = "",     # defaults to $Addon
  [string]$Mode        = "smoke",
  [string]$Convar      = "",     # defaults to "<addon>_e2e"
  [int]$Kills          = 5,      # bounded run: win threshold override
  [int]$RunSeconds     = 360,    # GPU/asset warmup (~2 min) + time to reach $Kills
  [int]$ShotInterval   = 20,     # seconds between screenshots
  # The marker contract. Override per run mode.
  [string[]]$RequireMarkers = @("\[E2E\] WIN"),
  [string[]]$FailPatterns   = @("Script Error", "attempt to", "nil value", "stack traceback", "ERROR_FILEOPEN")
)

$ErrorActionPreference = "Continue"

# `schtasks /run` executes this script with the arguments the task was
# REGISTERED with — there is no per-invocation argument channel. So vm.sh
# stages C:\dota\run-config.ps1 (plain `$Addon = '...'` assignments) next to
# this script, and dot-sourcing it here lets those values override the param
# defaults above. Without this, ADDON/RUN_MODE set on the laptop silently do
# nothing.
$cfgFile = "C:\dota\run-config.ps1"
if (Test-Path $cfgFile) { . $cfgFile }

if (-not $Convar) { $Convar = "${Addon}_e2e" }
if (-not $Map) { $Map = $Addon }

$win64  = Join-Path $Dota "game\bin\win64"
$log    = Join-Path $Dota "game\dota\console.log"
$result = "C:\dota-$Mode-result.txt"
$shots  = "C:\dota-shots"

"run start $(Get-Date -Format o) mode=$Mode addon=$Addon" | Out-File $result -Encoding utf8

# A stale console.log makes every subsequent run a lie. -conclearlog is not
# always enough, so delete it outright.
if (Test-Path $log) { Remove-Item $log -Force }

# ---------------------------------------------------------------- 1. cook
# resourcecompiler turns content/ sources into the compiled forms the client
# actually loads. Panorama and maps are served COMPILED even in tools mode, so
# skipping this means your UI changes do not exist.
$rc = Join-Path $win64 "resourcecompiler.exe"
"--- RESOURCE COMPILE ---" | Add-Content $result
& $rc -a -i "$Dota\content\dota_addons\$Addon\*" 2>&1 | Select-Object -Last 10 | Out-String | Add-Content $result

# ---------------------------------------------------------------- 2. launch
# -condebug writes console.log at all. -windowed at a small size keeps the
# capture cheap. Convars passed as +name value are set before the game mode
# activates, which is what makes convar-gating a viable switch.
$dotaArgs = @(
  "-novid", "-tools", "-addon", $Addon,
  "-condebug", "-nominidumps", "-nocrashdialog",
  "-windowed", "-w", "1280", "-h", "720",
  "+$Convar", "1",
  "+${Convar}_kills", "$Kills",
  "+dota_launch_custom_game", $Addon, $Map
)
"--- LAUNCH ---" | Add-Content $result
($dotaArgs -join " ") | Add-Content $result
$proc = Start-Process -FilePath (Join-Path $win64 "dota2.exe") -ArgumentList $dotaArgs -PassThru

# Optional MP4: if ffmpeg is on PATH (choco install ffmpeg during VM setup),
# record the desktop for the whole run. gdigrab captures the same session-1
# display head the screenshots use; -t bounds the recording so the recorder
# can never outlive the run. Screenshots answer "did it work"; the MP4 is what
# extract-frames.sh mines when you need to see a one-second event.
$video = "C:\dota-$Mode.mp4"
$rec = $null
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
  Remove-Item $video -Force -ErrorAction SilentlyContinue
  $ffArgs = @("-y", "-f", "gdigrab", "-framerate", "15", "-t", "$RunSeconds",
              "-i", "desktop", "-vf", "scale=1280:-2", "-pix_fmt", "yuv420p", $video)
  $rec = Start-Process -FilePath $ffmpeg.Source -ArgumentList $ffArgs -PassThru -WindowStyle Hidden
  "recording: $video (ffmpeg pid $($rec.Id))" | Add-Content $result
} else {
  "recording: skipped (no ffmpeg on PATH)" | Add-Content $result
}

# ---------------------------------------------------------- 3. observe
# Screenshots are the difference between "the log says it worked" and knowing
# it worked. Plenty of failures are invisible in a log: a particle that renders
# nothing, a panel covering the screen, a night-black arena.
New-Item -ItemType Directory -Force -Path $shots | Out-Null
Remove-Item "$shots\*.png" -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Real mouse input, injected into the game window. This is how you diagnose a
# UI bug with nobody present: sweep clicks across where a panel should be, and
# let the console log tell you whether the panel got the hit, the click fell
# through to the world, or input never reached the window at all.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DotaInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowW(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

function Invoke-ClickSweep {
  param([string]$Tag)
  # Dota's window class is "SDL_app".
  $hwnd = [DotaInput]::FindWindowW("SDL_app", $null)
  $r = New-Object DotaInput+RECT
  if ($hwnd -ne [IntPtr]::Zero -and [DotaInput]::GetWindowRect($hwnd, [ref]$r) -and ($r.Right - $r.Left) -gt 100) {
    [DotaInput]::SetForegroundWindow($hwnd) | Out-Null
    $ox = $r.Left; $oy = $r.Top; $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  } else {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $ox = 0; $oy = 0; $w = $b.Width; $h = $b.Height
  }
  "clicksweep $Tag window ox=$ox oy=$oy w=$w h=$h hwnd=$hwnd" | Add-Content $result
  Start-Sleep -Milliseconds 500
  foreach ($fy in @(0.34, 0.55)) {
    foreach ($fx in @(0.15, 0.29, 0.43, 0.57, 0.71, 0.85)) {
      $x = $ox + [int]($w * $fx); $y = $oy + [int]($h * $fy)
      [DotaInput]::SetCursorPos($x, $y) | Out-Null
      Start-Sleep -Milliseconds 250
      [DotaInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
      Start-Sleep -Milliseconds 60
      [DotaInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
      "clicksweep $Tag clicked $x,$y" | Add-Content $result
      Start-Sleep -Milliseconds 700
    }
  }
}

$elapsed = 0
# Two sweeps: one soon after the match goes live, one later in case the HUD
# was still loading during the first. -ge plus a fired-flag, NOT -eq: with a
# non-default -ShotInterval, $elapsed may never land exactly on these values,
# which would silently disable input injection.
$sweepTimes = @(140, 220)
$sweepsFired = @{}
while ($elapsed -lt $RunSeconds) {
  Start-Sleep -Seconds $ShotInterval
  $elapsed += $ShotInterval
  foreach ($t in $sweepTimes) {
    if ($elapsed -ge $t -and -not $sweepsFired[$t]) {
      $sweepsFired[$t] = $true
      Invoke-ClickSweep -Tag "t$t"
    }
  }
  try {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save((Join-Path $shots ("shot_{0:d4}s.png" -f $elapsed)))
    $gfx.Dispose(); $bmp.Dispose()
  } catch { "screenshot failed at ${elapsed}s: $_" | Add-Content $result }
}

"screenshots: $((Get-ChildItem $shots -Filter *.png).Count)" | Add-Content $result
"process alive at kill: $(-not $proc.HasExited)" | Add-Content $result
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }

# Let ffmpeg finalize the MP4 (its -t should have expired with the loop; give
# it a moment to flush the moov atom, then insist).
if ($rec -and -not $rec.HasExited) {
  $rec | Wait-Process -Timeout 30 -ErrorAction SilentlyContinue
  if (-not $rec.HasExited) { Stop-Process -Id $rec.Id -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $video) { "video: $video ($([math]::Round((Get-Item $video).Length / 1MB, 1)) MB)" | Add-Content $result }

# ---------------------------------------------------------- 4. verdict
$failures = @()

if (-not (Test-Path $log)) {
  $failures += "FAIL no console.log produced — the launch itself failed"
} else {
  $lines = Get-Content $log
  "console.log lines: $($lines.Count)" | Add-Content $result

  "--- ERROR PATTERNS ---" | Add-Content $result
  foreach ($pattern in $FailPatterns) {
    $hits = $lines | Select-String -Pattern $pattern | ForEach-Object { $_.Line }
    if ($hits) {
      $hits | Add-Content $result
      $failures += "FAIL error pattern matched: $pattern ($($hits.Count) line(s))"
    }
  }
  if (-not $failures) { "(none)" | Add-Content $result }

  "--- REQUIRED MARKERS ---" | Add-Content $result
  foreach ($marker in $RequireMarkers) {
    $hits = $lines | Select-String -Pattern $marker | ForEach-Object { $_.Line }
    if ($hits) {
      "OK   $marker" | Add-Content $result
      $hits | Select-Object -First 5 | Add-Content $result
    } else {
      "MISS $marker" | Add-Content $result
      $failures += "FAIL required marker never appeared: $marker"
    }
  }

  # Everything the game said about itself, for the post-mortem.
  "--- GAME MARKERS ---" | Add-Content $result
  ($lines | Select-String -Pattern "\[[A-Z0-9]+\]" | ForEach-Object { $_.Line }) | Add-Content $result

  "--- GAMERULES STATE ---" | Add-Content $result
  ($lines | Select-String -Pattern "entering state 'DOTA_GAMERULES" | ForEach-Object { $_.Line }) | Add-Content $result
}

if ($failures) {
  $failures | Add-Content $result
  "RUN RESULT: FAIL ($($failures.Count) failure(s))" | Add-Content $result
} else {
  "RUN RESULT: PASS" | Add-Content $result
}

# Flush the terminal marker BEFORE throwing. The control plane polls for
# "RUN DONE", so a run that dies without writing it hangs the poller for the
# full timeout — and a failing run is exactly when you want the evidence most.
"run done $(Get-Date -Format o)" | Add-Content $result
"RUN DONE" | Add-Content $result

if ($failures) { throw ($failures -join "; ") }
