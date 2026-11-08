/** Exact caller-selected native intent, including the companion full-access default.
 * Source lives in the captured launch binding/execution, not inferred from
 * this tuple. Native full access grants no outer OS or network privileges. */
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { TeamError } from './errors.mjs';
export function validateProfile(profile) {
  const names = ['sandboxMode', 'approvalPolicy', 'writableRoots', 'networkAccess', 'binding'];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || Object.keys(profile).some(key => !names.includes(key))
    || !['read-only', 'workspace-write', 'danger-full-access'].includes(profile.sandboxMode) || !['ask', 'never'].includes(profile.approvalPolicy)
    || !['enabled', 'restricted', 'unknown'].includes(profile.networkAccess) || !/^[a-f0-9]{64}$/.test(profile.binding)
    || !Array.isArray(profile.writableRoots) || profile.writableRoots.length > 64 || profile.writableRoots.some(root => typeof root !== 'string' || !isAbsolute(root) || root.includes('\0'))
    || (profile.sandboxMode === 'workspace-write' ? profile.writableRoots.length === 0 : profile.writableRoots.length !== 0)) throw new TeamError('INVALID_REQUEST', 'Invalid exact permission profile.');
  return { sandboxMode: profile.sandboxMode, approvalPolicy: profile.approvalPolicy, writableRoots: [...new Set(profile.writableRoots)].sort(), networkAccess: profile.networkAccess, binding: profile.binding };
}
export function verifyProfile(profile, actual) {
  const roots = profile.sandboxMode === 'workspace-write' ? [...new Set([actual?.sandbox?.workspaceRoot, ...(actual?.sandbox?.additionalWritableRoots ?? [])])].sort() : [];
  if (actual?.sandbox?.mode !== profile.sandboxMode || actual?.approvalPolicy !== profile.approvalPolicy || !isDeepStrictEqual(roots, profile.writableRoots)) {
    throw new TeamError('PERMISSION_MISMATCH', 'Native sandbox, approval or writable roots differ from the exact permission profile. No task was submitted.');
  }
}
