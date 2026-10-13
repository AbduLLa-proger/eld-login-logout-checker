export type DriverEventType = "login" | "logout";

export type DriverEventLabel = "Login" | "Logout";

export type ComparisonState = "match" | "mismatch" | "neutral";

export type DriverSide = "left" | "right";

export interface RawStatus {
  originalIndex: number;
  time: string;
  event: string;
  location: string;
  odometer: number | null;
  notes: string;
}

export interface DriverEvent extends RawStatus {
  type: DriverEventType;
  event: DriverEventLabel;
}

export interface ParsedDriverHtml {
  statuses: RawStatus[];
  authEvents: DriverEvent[];
}

export interface ParsedFlowTime {
  month: number;
  day: number;
  timestamp: number;
}

export interface PairResult {
  state: Extract<ComparisonState, "match" | "mismatch">;
  reason: string;
}

export interface ComparisonRow {
  events: Array<DriverEvent | null>;
  state: ComparisonState;
  reason: string;
  odometer: number;
  order: number;
}

export interface DriverComparison {
  rows: ComparisonRow[];
  firstSharedOdometer: number | null;
  driverCount: number;
}
