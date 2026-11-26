/** Code point order, so byte stability does not depend on the runtime's ICU data. */
export const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
