export interface ConformanceReport {
  readonly name: string;
  readonly ok: boolean;
  readonly checks: number;
  readonly failures: readonly string[];
}

export interface Checker {
  check(condition: boolean, message: string): boolean;
  report(): ConformanceReport;
}

export function checker(name: string): Checker {
  let checks = 0;
  const failures: string[] = [];

  return {
    check(condition, message) {
      checks += 1;
      if (!condition) failures.push(message);
      return condition;
    },
    report() {
      return { name, ok: failures.length === 0, checks, failures };
    },
  };
}

export const containsAll = (
  haystack: string,
  needles: readonly string[],
): boolean => {
  const lower = haystack.toLowerCase();
  return needles.every((needle) => lower.includes(needle.toLowerCase()));
};
