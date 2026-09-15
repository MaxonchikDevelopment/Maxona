import { readFile } from "fs/promises";
import path from "path";
import { gunzipSync } from "zlib";
import FitParser from "fit-file-parser";

export type HrProfileFromArchiveResult = {
  maxHr: number | null;
  maxHrCandidateCount: number;
  lthrEstimate: number | null;
  lthrCandidateCount: number;
  warnings: string[];
};

type CsvRow = Record<string, string>;

type FitRecord = {
  timestamp: Date;
  heart_rate?: number;
};

const MAX_HR_ACTIVITY_TYPES = new Set(["Run", "Ride", "VirtualRun", "VirtualRide"]);
const LTHR_CANDIDATE_LIMIT = 8;
const LTHR_MOVING_TIME_MIN_SEC = 25 * 60;
const LTHR_MOVING_TIME_MAX_SEC = 70 * 60;
const SHORT_ACTIVITY_THRESHOLD_SEC = 20 * 60;
const WARMUP_SHORT_SEC = 5 * 60;
const WARMUP_STANDARD_SEC = 10 * 60;

/**
 * Strava's activities.csv has duplicate header names (e.g. two "Max Heart Rate"
 * columns) from merging two internal field sets. Both are always populated
 * identically, so the first occurrence of each name is used.
 */
function parseCsv(text: string): CsvRow[] {
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") table.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    table.push(row);
  }

  if (table.length === 0) return [];
  const header = table[0];
  const firstIndexByName = new Map<string, number>();
  header.forEach((name, i) => {
    if (!firstIndexByName.has(name)) firstIndexByName.set(name, i);
  });

  return table.slice(1).map((cols) => {
    const obj: CsvRow = {};
    for (const [name, i] of firstIndexByName) obj[name] = cols[i] ?? "";
    return obj;
  });
}

function parseFitRecordsSync(fitBuffer: Buffer): FitRecord[] {
  const parser = new FitParser({ mode: "list" });
  let data: { records?: FitRecord[] } | undefined;
  parser.parse(fitBuffer as Parameters<typeof parser.parse>[0], (error, parsed) => {
    if (error) throw new Error(String(error));
    data = parsed as typeof data;
  });
  if (!data) throw new Error("FIT file produced no data");
  return data.records ?? [];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toFiniteNumber(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function computeMaxHr(rows: CsvRow[]): { maxHr: number | null; candidateCount: number; warning?: string } {
  const values = rows
    .filter((r) => MAX_HR_ACTIVITY_TYPES.has(r["Activity Type"]))
    .map((r) => toFiniteNumber(r["Max Heart Rate"]))
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => b - a);

  if (values.length >= 3) return { maxHr: values[2], candidateCount: values.length };
  if (values.length >= 1) {
    return {
      maxHr: values[0],
      candidateCount: values.length,
      warning: "low confidence: fewer than 3 samples",
    };
  }
  return { maxHr: null, candidateCount: 0, warning: "no maxHr samples found" };
}

async function resolveSustainedHr(
  archiveDir: string,
  row: CsvRow,
  warnings: string[],
): Promise<number | null> {
  const filename = row["Filename"];
  if (!filename) {
    warnings.push(`LTHR candidate missing Filename (activity ${row["Activity ID"] || "unknown"})`);
    return null;
  }

  const fitPath = path.join(archiveDir, filename);
  let buffer: Buffer;
  try {
    buffer = await readFile(fitPath);
  } catch {
    warnings.push(`could not read FIT file: ${filename}`);
    return null;
  }

  let fitBuffer = buffer;
  if (filename.endsWith(".gz") || (buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    try {
      fitBuffer = gunzipSync(buffer);
    } catch {
      warnings.push(`failed to gunzip FIT file: ${filename}`);
      return null;
    }
  }

  let records: FitRecord[];
  try {
    records = parseFitRecordsSync(fitBuffer);
  } catch {
    warnings.push(`failed to parse FIT file: ${filename}`);
    return null;
  }
  if (records.length === 0) {
    warnings.push(`no records in FIT file: ${filename}`);
    return null;
  }

  const first = records[0].timestamp;
  const last = records[records.length - 1].timestamp;
  const totalDurationSec = (last.getTime() - first.getTime()) / 1000;
  const warmupSec = totalDurationSec < SHORT_ACTIVITY_THRESHOLD_SEC ? WARMUP_SHORT_SEC : WARMUP_STANDARD_SEC;
  const cutoff = first.getTime() + warmupSec * 1000;

  const tail = records.filter((r) => r.timestamp.getTime() >= cutoff && r.heart_rate != null);
  if (tail.length === 0) {
    warnings.push(`no HR data after warmup window in FIT file: ${filename}`);
    return null;
  }

  return tail.reduce((sum, r) => sum + (r.heart_rate as number), 0) / tail.length;
}

async function computeLthr(
  archiveDir: string,
  rows: CsvRow[],
  warnings: string[],
): Promise<{ lthrEstimate: number | null; candidateCount: number }> {
  const candidates = rows
    .filter((r) => r["Activity Type"] === "Run")
    .filter((r) => {
      const movingTime = toFiniteNumber(r["Moving Time"]);
      return (
        movingTime != null &&
        movingTime >= LTHR_MOVING_TIME_MIN_SEC &&
        movingTime <= LTHR_MOVING_TIME_MAX_SEC
      );
    })
    .filter((r) => toFiniteNumber(r["Average Heart Rate"]) != null && toFiniteNumber(r["Relative Effort"]) != null)
    .sort((a, b) => (toFiniteNumber(b["Relative Effort"]) ?? 0) - (toFiniteNumber(a["Relative Effort"]) ?? 0))
    .slice(0, LTHR_CANDIDATE_LIMIT);

  const sustainedHrs: number[] = [];
  for (const row of candidates) {
    const hr = await resolveSustainedHr(archiveDir, row, warnings);
    if (hr != null) sustainedHrs.push(hr);
  }

  if (sustainedHrs.length < 3) {
    warnings.push("insufficient data for LTHR");
    return { lthrEstimate: null, candidateCount: sustainedHrs.length };
  }

  return { lthrEstimate: median(sustainedHrs), candidateCount: sustainedHrs.length };
}

export async function computeHrProfileFromArchive(archiveDir: string): Promise<HrProfileFromArchiveResult> {
  const warnings: string[] = [];
  const csvText = await readFile(path.join(archiveDir, "activities.csv"), "utf8");
  const rows = parseCsv(csvText);

  const maxHrResult = computeMaxHr(rows);
  if (maxHrResult.warning) warnings.push(maxHrResult.warning);

  const lthrResult = await computeLthr(archiveDir, rows, warnings);

  return {
    maxHr: maxHrResult.maxHr,
    maxHrCandidateCount: maxHrResult.candidateCount,
    lthrEstimate: lthrResult.lthrEstimate,
    lthrCandidateCount: lthrResult.candidateCount,
    warnings,
  };
}
