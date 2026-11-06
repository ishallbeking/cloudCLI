import fs from 'node:fs/promises';
// Keep the compiled-only distribution's capabilities aligned on reinstall.
export async function installApproveForMeServer() {
  const path = new URL('../package/dist-server/server/modules/providers/services/provider-capabilities.service.js', import.meta.url);
  let code = await fs.readFile(path, 'utf8');
  const start = code.indexOf("provider: 'codex',");
  if (start < 0) throw new Error('Codex capabilities upstream changed');
  const end = code.indexOf('defaultPermissionMode:', start);
  if (end < 0) throw new Error('Codex capabilities boundary changed');
  const before = "permissionModes: ['default', 'acceptEdits', 'bypassPermissions']";
  const after = "permissionModes: ['default', 'approveForMe', 'acceptEdits', 'bypassPermissions']";
  const block = code.slice(start, end);
  if (block.includes(after)) return;
  if (block.split(before).length !== 2) throw new Error('Codex permission modes upstream changed');
  await fs.writeFile(path, code.slice(0, start) + block.replace(before, after) + code.slice(end));
}
