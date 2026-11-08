# Run by the uninstaller only when the player chooses to delete the launcher's
# data: removes the launcher's sign-ins from Windows Credential Manager. Only
# generic credentials named "<key>.KairoLauncher" are removed, nothing else.
$ErrorActionPreference = 'Stop'
$Service = 'KairoLauncher'
Add-Type -Namespace Kairo -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr creds);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredDeleteW(string target, int type, int flags);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr buffer);
'@
$count = 0
$list = [IntPtr]::Zero
if (-not [Kairo.Cred]::CredEnumerateW("*.$Service", 0, [ref]$count, [ref]$list)) { exit 0 }
$names = @()
for ($i = 0; $i -lt $count; $i++) {
  $p = [Runtime.InteropServices.Marshal]::ReadIntPtr($list, $i * [IntPtr]::Size)
  # CREDENTIALW starts with Flags (4 bytes), Type (4 bytes), then TargetName.
  $type = [Runtime.InteropServices.Marshal]::ReadInt32($p, 4)
  $name = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($p, 8))
  if ($type -eq 1 -and $name.EndsWith(".$Service", [StringComparison]::Ordinal)) { $names += $name }
}
[Kairo.Cred]::CredFree($list)
foreach ($n in $names) { [void][Kairo.Cred]::CredDeleteW($n, 1, 0) }
Write-Output "Removed $($names.Count) sign-in entries."
