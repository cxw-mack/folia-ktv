import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createKtvFirewallSetup } = require('../../../electron/ktv/firewall.cjs') as {
    createKtvFirewallSetup: (options: Record<string, unknown>) => () => Promise<{
        allowed: boolean;
        alreadyConfigured?: boolean;
        reason?: string;
        detail?: string;
    }>;
};

function fakeProcess() {
    const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    const spawnProcess = vi.fn((_command: string, _args: string[], _options: unknown) => child);
    return { child, spawnProcess };
}

describe('KTV Windows firewall setup', () => {
    it('skips firewall changes outside Windows', async () => {
        const { spawnProcess } = fakeProcess();
        const setup = createKtvFirewallSetup({ platform: 'darwin', executablePath: '/Applications/Folia.app' , spawnProcess });

        await expect(setup()).resolves.toEqual({ allowed: true, alreadyConfigured: true });
        expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('limits the Windows rule to this EXE and the local subnet', async () => {
        const { child, spawnProcess } = fakeProcess();
        const setup = createKtvFirewallSetup({
            platform: 'win32',
            executablePath: 'C:\\KTV\\Folia-KTV.exe',
            spawnProcess,
        });
        const result = setup();
        expect(spawnProcess.mock.calls[0][0]).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
        const args = spawnProcess.mock.calls[0][1] as string[];
        const encodedIndex = args.indexOf('-EncodedCommand');
        const script = Buffer.from(args[encodedIndex + 1], 'base64').toString('utf16le');
        const encodedRuleName = /\$ruleName = \[Text\.Encoding\]::UTF8\.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)/.exec(script)?.[1];
        const ruleName = encodedRuleName ? Buffer.from(encodedRuleName, 'base64').toString('utf8') : '';

        expect(script).toContain('Folia KTV local network access');
        expect(script).toContain('New-NetFirewallRule -Name $ruleName');
        expect(script).toContain('Get-NetFirewallRule -Name $ruleNames -ErrorAction SilentlyContinue |');
        expect(script).not.toContain('Get-NetFirewallRule -Name $ruleNames -Direction Inbound -Enabled True -Action Allow');
        expect(ruleName).toBe(`FoliaKTVLocalNetworkAccess_${createHash('sha256').update('c:\\ktv\\folia-ktv.exe').digest('hex').slice(0, 12)}`);
        expect(script).toContain("-Program $program");
        expect(script).toContain("FromBase64String('__PROGRAM_BASE64__')");
        expect(script).toContain("$remoteAddresses -contains 'LocalSubnet'");
        expect(script).toContain("$port.Protocol -eq 'TCP'");
        expect(script).toContain('-Profile Private,Public');
        expect(script).toContain('-Protocol TCP -LocalPort Any -RemoteAddress LocalSubnet');
        expect(script).not.toContain('-RemoteAddress Any');
        child.stdout.write('FOLIA_RULE_CREATED');
        child.emit('close', 0);
        await expect(result).resolves.toEqual({ allowed: true, alreadyConfigured: false });
    });

    it.skipIf(process.platform !== 'win32')('generates valid PowerShell syntax before showing the Windows authorization prompt', async () => {
        const { child, spawnProcess } = fakeProcess();
        const setup = createKtvFirewallSetup({
            platform: 'win32', executablePath: 'C:\\KTV\\Folia-KTV.exe', spawnProcess,
        });
        const result = setup();
        const args = spawnProcess.mock.calls[0][1] as string[];
        const encodedIndex = args.indexOf('-EncodedCommand');
        const script = Buffer.from(args[encodedIndex + 1], 'base64').toString('utf16le');
        const adminScript = /\$adminScript = @'\r?\n([\s\S]*?)\r?\n'@/.exec(script)?.[1];
        expect(adminScript).toBeTruthy();
        const parserCommand = '$source = [Console]::In.ReadToEnd(); $tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_) }; exit 1 }';
        for (const source of [script, adminScript!]) {
            const parsed = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', parserCommand], {
                input: source, encoding: 'utf8', windowsHide: true,
            });
            expect(parsed.status, parsed.stderr || parsed.error?.message).toBe(0);
        }
        const readOnlyQuery = script.slice(0, script.indexOf("$adminScript = @'"));
        const queryEncoded = Buffer.from(readOnlyQuery, 'utf16le').toString('base64');
        const query = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', queryEncoded], {
            encoding: 'utf8', windowsHide: true,
        });
        expect(query.status, query.stderr || query.stdout || query.error?.message).toBe(0);
        child.emit('close', 0);
        await expect(result).resolves.toEqual({ allowed: true, alreadyConfigured: false });
    });

    it('reuses an existing rule and reports a declined Windows elevation prompt', async () => {
        const existing = fakeProcess();
        const setupExisting = createKtvFirewallSetup({
            platform: 'win32', executablePath: 'C:\\KTV\\Folia-KTV.exe', spawnProcess: existing.spawnProcess,
        });
        const existingResult = setupExisting();
        existing.child.stdout.write('FOLIA_RULE_EXISTS');
        existing.child.emit('close', 0);
        await expect(existingResult).resolves.toEqual({ allowed: true, alreadyConfigured: true });

        const declined = fakeProcess();
        const setupDeclined = createKtvFirewallSetup({
            platform: 'win32', executablePath: 'C:\\KTV\\Folia-KTV.exe', spawnProcess: declined.spawnProcess,
        });
        const declinedResult = setupDeclined();
        declined.child.stdout.write('FOLIA_AUTHORIZATION_DECLINED');
        declined.child.emit('close', 1223);
        await expect(declinedResult).resolves.toMatchObject({ allowed: false, reason: 'authorizationDeclined' });

        const failed = fakeProcess();
        const setupFailed = createKtvFirewallSetup({
            platform: 'win32', executablePath: 'C:\\KTV\\Folia-KTV.exe', spawnProcess: failed.spawnProcess,
        });
        const failedResult = setupFailed();
        failed.child.stderr.write('New-NetFirewallRule failed: access is denied');
        failed.child.emit('close', 1);
        await expect(failedResult).resolves.toEqual({
            allowed: false,
            reason: 'setupFailed',
            detail: 'New-NetFirewallRule failed: access is denied',
        });

        const encodedDetail = Buffer.from('Get-NetFirewallRule parameter set is invalid', 'utf8').toString('base64');
        const queryFailed = fakeProcess();
        const setupQueryFailed = createKtvFirewallSetup({
            platform: 'win32', executablePath: 'C:\\KTV\\Folia-KTV.exe', spawnProcess: queryFailed.spawnProcess,
        });
        const queryFailedResult = setupQueryFailed();
        queryFailed.child.stderr.write(`#< CLIXML\nFOLIA_ERROR_DETAIL:QUERY:${encodedDetail}`);
        queryFailed.child.emit('close', 1);
        await expect(queryFailedResult).resolves.toMatchObject({
            allowed: false,
            reason: 'setupFailed',
            detail: 'QUERY: Get-NetFirewallRule parameter set is invalid',
        });
    });

    it('rejects malformed executable paths without invoking PowerShell', async () => {
        const { spawnProcess } = fakeProcess();
        const setup = createKtvFirewallSetup({ platform: 'win32', executablePath: 'Folia-KTV.exe', spawnProcess });

        await expect(setup()).resolves.toEqual({
            allowed: false,
            reason: 'invalidProgramPath',
            detail: 'Folia executable path is not an absolute .exe path',
        });
        expect(spawnProcess).not.toHaveBeenCalled();
    });
});
