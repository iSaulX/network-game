/**
 * Minimal type declarations for the `bun:test` APIs used by the engine tests.
 *
 * The project does not depend on `@types/bun`, and Task 03 forbids adding
 * dependencies, so `bunx tsc --noEmit` would otherwise fail to resolve
 * `bun:test`. If `@types/bun` is added later, delete this file.
 */
declare module "bun:test" {
  type TestFn = () => void | Promise<void>;

  interface Matchers {
    not: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeNull(): void;
    toBeTrue(): void;
    toBeFalse(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toThrow(expected?: unknown): void;
    toMatchObject(expected: unknown): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: TestFn, timeoutMs?: number): void;
  export function it(name: string, fn: TestFn, timeoutMs?: number): void;
  export function expect(actual: unknown): Matchers;
}
