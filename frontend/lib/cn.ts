/** Join conditional class names without a dependency. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}
