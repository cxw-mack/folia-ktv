const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const WINDOWS_POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function getPowerShellDetail(output, exitCode) {
    const text = String(output || '');
    const marker = text.match(/FOLIA_ERROR_DETAIL:([A-Z_]+):([A-Za-z0-9+/=]+)/);
    if (marker) {
        try {
            return `${marker[1]}: ${Buffer.from(marker[2], 'base64').toString('utf8')}`.slice(0, 600);
        } catch {
            return `Windows 防火墙操作失败（${marker[1]}）。`;
        }
    }

    if (/#?<Objs\b|<Objs\b/.test(text)) return `Windows 防火墙命令失败（PowerShell 退出代码 ${exitCode}），错误详情格式无法解析。`;
    return text.trim().replace(/\s+/g, ' ').slice(-600) || `PowerShell exited with code ${exitCode}`;
}

// Adds a one-time, executable-specific firewall rule for phone access on the local subnet.
function createKtvFirewallSetup({ platform = process.platform, executablePath = process.execPath, spawnProcess = spawn } = {}) {
    return () => new Promise(resolve => {
        if (platform !== 'win32') {
            resolve({ allowed: true, alreadyConfigured: true });
            return;
        }

        const program = String(executablePath || '');
        if (!path.isAbsolute(program) || path.extname(program).toLowerCase() !== '.exe') {
            resolve({ allowed: false, reason: 'invalidProgramPath', detail: 'Folia executable path is not an absolute .exe path' });
            return;
        }

        const resultFile = path.join(os.tmpdir(), `folia-ktv-firewall-${randomUUID()}.txt`);
        const ruleName = `FoliaKTVLocalNetworkAccess_${createHash('sha256').update(program.toLowerCase()).digest('hex').slice(0, 12)}`;
        const programBase64 = Buffer.from(program, 'utf8').toString('base64');
        const resultFileBase64 = Buffer.from(resultFile, 'utf8').toString('base64');
        const powershellBase64 = Buffer.from(WINDOWS_POWERSHELL, 'utf8').toString('base64');
        const ruleNameBase64 = Buffer.from(ruleName, 'utf8').toString('base64');

        const script = `
$ErrorActionPreference = 'Stop'
$ruleName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${ruleNameBase64}'))
$ruleNames = @($ruleName, 'FoliaKTVLocalNetworkAccess')
$displayName = 'Folia KTV local network access'
$program = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${programBase64}'))
$resultFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${resultFileBase64}'))
$powershell = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${powershellBase64}'))
function Write-FoliaError($stage, $message) {
    $encodedMessage = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$message))
    [Console]::Out.WriteLine(('FOLIA_ERROR_DETAIL:{0}:{1}' -f $stage, $encodedMessage))
}
$findMatchingRule = {
    Get-NetFirewallRule -Name $ruleNames -ErrorAction SilentlyContinue |
    Where-Object {
        $rule = $_
        $application = $rule | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        $address = $rule | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
        $port = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        $remoteAddresses = @($address.RemoteAddress)
        $localPorts = @($port.LocalPort)
        $profiles = @(([string]$rule.Profile).Split(',') | ForEach-Object { $_.Trim() })
        $rule.Direction -eq 'Inbound' -and
            $rule.Enabled -eq 'True' -and
            $rule.Action -eq 'Allow' -and
        $application.Program -ieq $program -and
            $remoteAddresses -contains 'LocalSubnet' -and
            $port.Protocol -eq 'TCP' -and $localPorts -contains 'Any' -and
            $profiles -contains 'Private' -and $profiles -contains 'Public'
    } |
    Select-Object -First 1
}
try {
    if (& $findMatchingRule) { Write-Output 'FOLIA_RULE_EXISTS'; exit 0 }
} catch {
    Write-FoliaError 'QUERY' $_.Exception.Message
    exit 1
}
$adminScript = @'
$ErrorActionPreference = 'Stop'
$program = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PROGRAM_BASE64__'))
$resultFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RESULT_FILE_BASE64__'))
$encoding = New-Object System.Text.UTF8Encoding($false)
try {
    $ruleName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RULE_NAME_BASE64__'))
    New-NetFirewallRule -Name $ruleName -DisplayName 'Folia KTV local network access' -Direction Inbound -Enabled True -Action Allow -Profile Private,Public -Program $program -Protocol TCP -LocalPort Any -RemoteAddress LocalSubnet | Out-Null
    [System.IO.File]::WriteAllText($resultFile, 'created', $encoding)
    exit 0
} catch {
    $message = [string]$_.Exception.Message
    try { [System.IO.File]::WriteAllText($resultFile, ('error|' + $message), $encoding) } catch {}
    exit 1
}
'@
$adminScript = $adminScript.Replace('__PROGRAM_BASE64__', '${programBase64}')
$adminScript = $adminScript.Replace('__RESULT_FILE_BASE64__', '${resultFileBase64}')
$adminScript = $adminScript.Replace('__RULE_NAME_BASE64__', '${ruleNameBase64}')
$adminEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($adminScript))
try {
    $created = Start-Process -FilePath $powershell -ArgumentList @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $adminEncoded
    ) -Verb RunAs -Wait -PassThru -ErrorAction Stop
} catch {
    if ($_.Exception.HResult -eq -2147023673) {
        Write-Output 'FOLIA_AUTHORIZATION_DECLINED'
        exit 1223
    }
    Write-FoliaError 'ELEVATION' $_.Exception.Message
    exit 1
}
if ($created.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $resultFile) {
        $adminResult = [System.IO.File]::ReadAllText($resultFile)
        Write-FoliaError 'CREATE' ('PowerShell exited with code {0}: {1}' -f $created.ExitCode, $adminResult)
    } else {
        Write-FoliaError 'CREATE' ('PowerShell exited with code {0}: no elevated result was returned' -f $created.ExitCode)
    }
    exit $created.ExitCode
}
try {
    if (-not (& $findMatchingRule)) {
        Write-FoliaError 'VALIDATION' 'The firewall rule was created but could not be found in the active rule set.'
        exit 1
    }
} catch {
    Write-FoliaError 'VALIDATION' $_.Exception.Message
    exit 1
}
Write-Output 'FOLIA_RULE_CREATED'
`;
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        let child;
        try {
            child = spawnProcess(WINDOWS_POWERSHELL, [
                '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
            ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch {
            try { fs.rmSync(resultFile, { force: true }); } catch {}
            resolve({ allowed: false, reason: 'spawnFailed' });
            return;
        }

        let output = '';
        let settled = false;
        let timer;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { fs.rmSync(resultFile, { force: true }); } catch {}
            resolve(result);
        };
        child.stdout?.on('data', chunk => { output += String(chunk); });
        child.stderr?.on('data', chunk => { output += String(chunk); });
        child.once('error', error => finish({ allowed: false, reason: 'spawnFailed', detail: error.message }));
        child.once('close', code => {
            const result = code === 0
                ? { allowed: true, alreadyConfigured: output.includes('FOLIA_RULE_EXISTS') }
                : {
                allowed: false,
                reason: output.includes('FOLIA_AUTHORIZATION_DECLINED') || code === 1223
                    ? 'authorizationDeclined' : 'setupFailed',
                detail: getPowerShellDetail(output, code),
            };
            finish(result);
        });
        timer = setTimeout(() => {
            child.kill();
            finish({ allowed: false, reason: 'authorizationTimedOut', detail: 'Windows firewall authorization timed out after 120 seconds' });
        }, 120_000);
        timer.unref?.();
    });
}

module.exports = { createKtvFirewallSetup };
