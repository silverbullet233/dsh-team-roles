/** Observed native completion, never a global admission or resource-release fence. */
const states = ['running', 'stopping', 'completed', 'killed', 'failed'];
const boolean = value => typeof value === 'boolean' ? value : null;
export function executionEvidence(status, jobs) {
  const counts = jobs?.available === true && states.every(key => Number.isSafeInteger(jobs.counts?.[key]) && jobs.counts[key] >= 0)
    ? Object.fromEntries(states.map(key => [key, jobs.counts[key]])) : null;
  const sameRootCut = Number.isSafeInteger(status.asOfSeq) && status.asOfSeq === jobs?.rootAsOfSeq;
  const ownedJobsSettled = counts && counts.running + counts.stopping > 0 ? false
    : counts && sameRootCut && jobs.ownerScopeUnchangedAtCheck === true ? true : null;
  const nativeTeamCompleted = boolean(status.teamCompleted);
  const completed = nativeTeamCompleted === false || ownedJobsSettled === false ? false
    : nativeTeamCompleted === true && ownedJobsSettled === true ? true : null;
  return { completed, nativeTeamCompleted, ownedJobsSettled, scope: 'native-team-and-owned-job-records', atomic: false, admissionBarrier: false, resourceReleaseVerified: false, goalAccepted: null,
    jobs: { available: jobs?.available === true, reason: jobs?.reason ?? null, rootAsOfSeq: Number.isSafeInteger(jobs?.rootAsOfSeq) ? jobs.rootAsOfSeq : null,
      ownerScopeUnchangedAtCheck: boolean(jobs?.ownerScopeUnchangedAtCheck), sameRootCut, counts } };
}
