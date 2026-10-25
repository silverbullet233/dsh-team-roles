/** Settle every owned contribution before reporting cleanup failure. */
export async function disposeContributions(disposers) {
  const results = await Promise.allSettled(disposers.toReversed().map(async dispose => dispose()));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, 'role contribution cleanup failed');
}
