// Types for tools/units/composed-baseline.mjs (the backend tsconfig has no allowJs).
export type SectionMode = "ordered" | "membership"
export interface Section { mode: SectionMode; value: unknown }
export interface BaselineSection { mode: SectionMode; members: unknown[] }
export declare const BASELINE_DIR: string
export declare function baselineFile(tree: "frontend" | "backend"): string
export declare function canonical(value: unknown): unknown
export declare function ordered(value: unknown): Section
export declare function membership(value: unknown): Section
export declare function sectionsOf(snapshot: Record<string, Section>): Record<string, BaselineSection>
export declare function serialize(snapshot: Record<string, Section>): string
export declare function sectionDiff(expected: BaselineSection | undefined, actual: BaselineSection): string[]
export declare function baselineFor(
  root: string,
  file: string,
  snapshot: Record<string, Section>,
  write?: boolean,
): { expected: Record<string, BaselineSection>; actual: Record<string, BaselineSection> }
