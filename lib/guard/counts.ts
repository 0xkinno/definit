/**
 * Case counts, derived from the corpus in exactly one place.
 *
 * The rule this module exists to enforce: nobody types "nine cases" again. A
 * document, a page or a script that wants to say how many cases there are asks
 * here, and this asks the case definitions.
 *
 * It is pure and has no imports, so the same function runs in the proof script,
 * in a server component, and in a unit test.
 */

export interface CaseCounts {
  total: number;
  releaseExpected: number;
  refusalExpected: number;
}

export interface CountableCase {
  expected: string;
}

/** Derive counts from the case definitions themselves. */
export function caseCountsFrom(cases: readonly CountableCase[]): CaseCounts {
  return {
    total: cases.length,
    releaseExpected: cases.filter((item) => item.expected === "SETTLE").length,
    refusalExpected: cases.filter((item) => item.expected === "REFUSE").length,
  };
}

/**
 * Derive counts from what a run actually observed.
 *
 * The caller supplies the release predicate, because the run exposes the
 * outcome as a boolean (`intervention.released`) while the written report
 * exposes it as prose (`actual: "released"`). Neither shape is allowed to
 * change what the count means.
 */
export function observedCounts<T>(
  entries: readonly T[],
  isRelease: (entry: T) => boolean,
): CaseCounts {
  let releaseExpected = 0;
  for (const entry of entries) {
    if (isRelease(entry)) releaseExpected += 1;
  }
  return {
    total: entries.length,
    releaseExpected,
    refusalExpected: entries.length - releaseExpected,
  };
}

/** True when this report row describes a release. */
export function reportRowReleased(entry: { actual: string }): boolean {
  return entry.actual === "released";
}

export function describeCounts(counts: CaseCounts): string {
  return `${counts.total} cases \u00b7 ${counts.refusalExpected} refusal cases \u00b7 ${counts.releaseExpected} release cases`;
}

export function describeScore(passing: number, total: number): string {
  return `${passing} / ${total} passing`;
}

/** Every field agrees. Used by the consistency assertion and by tests. */
export function countsAgree(a: CaseCounts, b: CaseCounts): boolean {
  return (
    a.total === b.total &&
    a.releaseExpected === b.releaseExpected &&
    a.refusalExpected === b.refusalExpected
  );
}
