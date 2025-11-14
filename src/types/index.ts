import type { Readable } from "node:stream";

import { reolinkTimeToDate, toReolinkTimeId } from "../utils";

/** Generic Reolink JSON response type */
export type ReolinkJson = Array<Record<string, any>>;

/** Command list mapping for Reolink API commands */
export type CmdListType = Record<string, Record<string, number>> | Record<string, Array<number>> | null;

/**
 * VOD search status information
 */
export interface SearchStatus {
  /** Month number (1-12) */
  mon: number;
  /** Table of available recording days as a string */
  table: string;
  /** Year */
  year: number;
}

/**
 * Time representation in Reolink format
 */
export interface SearchTime {
  /** Year */
  year: number;
  /** Month (1-12) */
  mon: number;
  /** Day of month (1-31) */
  day: number;
  /** Hour (0-23) */
  hour: number;
  /** Minute (0-59) */
  min: number;
  /** Second (0-59) */
  sec: number;
}

/**
 * Represents a video file in search results
 */
export interface SearchFile {
  /** Start time of the recording */
  StartTime: SearchTime;
  /** End time of the recording */
  EndTime: SearchTime;
  /** Video frame rate */
  frameRate: number;
  /** Video height in pixels */
  height: number;
  /** Video width in pixels */
  width: number;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** File type (e.g., "main", "sub") */
  type: string;
}

/**
 * Daylight Saving Time configuration
 */
export interface GetTimeDst {
  /** Whether DST is enabled */
  enable: boolean;
  /** DST offset in hours */
  offset: number;
  /** DST start month */
  startMon?: number;
  /** DST start week of month */
  startWeek?: number;
  /** DST start weekday */
  startWeekday?: number;
  /** DST start hour */
  startHour?: number;
  /** DST start minute */
  startMin?: number;
  /** DST start second */
  startSec?: number;
  /** DST end month */
  endMon?: number;
  /** DST end week of month */
  endWeek?: number;
  /** DST end weekday */
  endWeekday?: number;
  /** DST end hour */
  endHour?: number;
  /** DST end minute */
  endMin?: number;
  /** DST end second */
  endSec?: number;
  [key: string]: number | boolean | undefined;
}

/**
 * Current time information from camera/NVR
 */
export interface GetTime {
  /** Current year */
  year: number;
  /** Current month (1-12) */
  mon: number;
  /** Current day */
  day: number;
  /** Current hour */
  hour: number;
  /** Current minute */
  min: number;
  /** Current second */
  sec: number;
  /** Hour format (12 or 24) */
  hourFmt: number;
  /** Time format string */
  timeFmt: string;
  /** Timezone offset in seconds */
  timeZone: number;
}

/**
 * Complete time response including DST information
 */
export interface GetTimeResponse {
  /** DST configuration */
  Dst: GetTimeDst;
  /** Current time information */
  Time: GetTime;
}

type DstRuleCalculator = (year: number) => Date;

interface DstRule {
  month: number;
  week: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEBUG_ENABLED = Boolean(process?.env?.REOLINK_AIO_DEBUG);

function debugLog(message: string, ...args: Array<unknown>): void {
  if (DEBUG_ENABLED) {
    // eslint-disable-next-line no-console
    console.debug(`[reolink-aio][types] ${message}`, ...args);
  }
}

function pythonWeekday(date: Date): number {
  // Python weekday: Monday == 0 ... Sunday == 6
  return (date.getUTCDay() + 6) % 7;
}

function createDstRuleCalculator(data: GetTimeDst, prefix: "start" | "end"): DstRuleCalculator {
  const rule: DstRule = {
    month: Number(data[`${prefix}Mon`] ?? 0),
    week: Number(data[`${prefix}Week`] ?? 0),
    weekday: ((Number(data[`${prefix}Weekday`] ?? 0) - 1) % 7 + 7) % 7,
    hour: Number(data[`${prefix}Hour`] ?? 0),
    minute: Number(data[`${prefix}Min`] ?? 0),
    second: Number(data[`${prefix}Sec`] ?? 0)
  };

  return (year: number) => {
    let workingYear = year;
    let date: Date;

    if (rule.week === 5) {
      const nextMonth = rule.month < 12 ? rule.month + 1 : 1;
      if (rule.month === 12) {
        workingYear += 1;
      }
      date = new Date(Date.UTC(workingYear, nextMonth - 1, 1));
    } else {
      date = new Date(Date.UTC(workingYear, rule.month - 1, 1));
      date = new Date(date.getTime() + rule.week * WEEK_IN_MS);
    }

    if (pythonWeekday(date) < rule.weekday) {
      date = new Date(date.getTime() - WEEK_IN_MS);
    }

    const weekdayDiff = pythonWeekday(date) - rule.weekday;
    date = new Date(date.getTime() + weekdayDiff * DAY_IN_MS);

    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        rule.hour,
        rule.minute,
        rule.second
      )
    );
  };
}

function deltaToString(deltaMs: number): string {
  if (deltaMs === 0) {
    return "";
  }
  const sign = deltaMs < 0 ? "-" : "+";
  let remaining = Math.abs(deltaMs);
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  remaining -= hours * 60 * 60 * 1000;
  const minutes = Math.floor(remaining / (60 * 1000));
  remaining -= minutes * 60 * 1000;
  const seconds = Math.floor(remaining / 1000);
  remaining -= seconds * 1000;

  if (remaining !== 0) {
    return `${sign}${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${remaining
      .toString()
      .padStart(6, "0")}`;
  }

  if (seconds !== 0) {
    return `${sign}${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${sign}${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Timezone implementation compatible with Reolink camera/NVR time formats.
 * Handles UTC offsets and Daylight Saving Time transitions.
 * 
 * @example
 * ```typescript
 * const tz = ReolinkTimezone.createOrGet(timeResponse);
 * const tzName = tz.tzname(); // "UTC+05:00"
 * const offset = tz.utcoffset(new Date()); // offset in milliseconds
 * ```
 */
export class ReolinkTimezone {
  private static cache = new Map<string, ReolinkTimezone>();

  /**
   * Factory method to create or retrieve cached timezone instance
   * @param data - Time response data from camera/NVR
   * @returns Cached or new ReolinkTimezone instance
   */
  static createOrGet(data: GetTimeResponse): ReolinkTimezone {
    const keyParts: Array<string> = [String(data.Time.timeZone)];
    if (data.Dst.enable) {
      const dstKeys = Object.keys(data.Dst)
        .filter((k) => k !== "enable")
        .sort()
        .map((key) => `${key}:${String(data.Dst[key])}`);
      keyParts.push(...dstKeys);
    }
    const key = keyParts.join("|");
    const existing = this.cache.get(key);
    if (existing) {
      return existing;
    }
    const tz = new ReolinkTimezone(data);
    this.cache.set(key, tz);
    return tz;
  }

  private readonly dstEnabled: boolean;
  private readonly dstOffsetMs: number;
  private readonly utcOffsetMs: number;
  private readonly startRule: DstRuleCalculator | null;
  private readonly endRule: DstRuleCalculator | null;
  private readonly yearCache = new Map<number, { start: Date; end: Date }>();
  private nameCache?: string;

  constructor(data: GetTimeResponse) {
    this.dstEnabled = Boolean(data.Dst?.enable);
    this.dstOffsetMs = this.dstEnabled ? Number(data.Dst.offset ?? 0) * 60 * 60 * 1000 : 0;
    this.utcOffsetMs = -Number(data.Time.timeZone ?? 0) * 1000;
    this.startRule = this.dstEnabled ? createDstRuleCalculator(data.Dst, "start") : null;
    this.endRule = this.dstEnabled ? createDstRuleCalculator(data.Dst, "end") : null;
  }

  /**
   * Get timezone name string
   * @param date - Optional date to check DST status
   * @returns Timezone name in format "UTC±HH:MM"
   */
  tzname(date: Date | null = null): string {
    if (date === null) {
      if (!this.nameCache) {
        this.nameCache = `UTC${deltaToString(this.utcOffsetMs)}`;
      }
      return this.nameCache;
    }
    return `UTC${deltaToString(this.utcoffset(date))}`;
  }

  /**
   * Calculate UTC offset for given date (includes DST if applicable)
   * @param date - Date to calculate offset for, null for base offset
   * @returns UTC offset in milliseconds
   */
  utcoffset(date: Date | null): number {
    if (!this.dstEnabled || date === null) {
      return this.utcOffsetMs;
    }
    const { start, end } = this.getYearTransitions(date.getUTCFullYear());
    if (date >= start && date <= end) {
      return this.utcOffsetMs + this.dstOffsetMs;
    }
    return this.utcOffsetMs;
  }

  /**
   * Get DST offset for given date
   * @param date - Date to check DST status for
   * @returns DST offset in milliseconds (0 if not in DST period)
   */
  dst(date: Date | null): number {
    if (!this.dstEnabled || date === null) {
      return 0;
    }
    const { start, end } = this.getYearTransitions(date.getUTCFullYear());
    if (date >= start && date <= end) {
      return this.dstOffsetMs;
    }
    return 0;
  }

  private getYearTransitions(year: number): { start: Date; end: Date } {
    const cached = this.yearCache.get(year);
    if (cached) {
      return cached;
    }
    if (!this.startRule || !this.endRule) {
      const epoch = new Date(Date.UTC(year, 0, 1));
      const fallback = { start: epoch, end: epoch };
      this.yearCache.set(year, fallback);
      return fallback;
    }
    const start = this.startRule(year);
    const end = this.endRule(year);
    const transitions = { start, end };
    this.yearCache.set(year, transitions);
    return transitions;
  }

  toString(): string {
    return this.tzname(null);
  }
}

/**
 * Wrapper for VOD search status response, provides iterable interface over recording days
 * 
 * @example
 * ```typescript
 * const status = new VODSearchStatus(data);
 * console.log(status.year, status.month); // 2023 11
 * for (const date of status) {
 *   console.log(date); // Dates with recordings
 * }
 * ```
 */
export class VODSearchStatus implements Iterable<Date> {
  private readonly daysCache: Array<number>;

  constructor(private readonly data: Record<string, any>) {
    const table = typeof data.table === "string" ? data.table : "";
    this.daysCache = table.split("").reduce<Array<number>>((acc, flag, index) => {
      if (flag === "1") {
        acc.push(index + 1);
      }
      return acc;
    }, []);
  }

  get year(): number {
    return Number(this.data.year);
  }

  get month(): number {
    return Number(this.data.mon);
  }

  get days(): ReadonlyArray<number> {
    return this.daysCache;
  }

  [Symbol.iterator](): Iterator<Date> {
    let cursor = 0;
    const year = this.year;
    const month = this.month;
    const days = this.daysCache;
    return {
      next(): IteratorResult<Date> {
        if (cursor >= days.length) {
          return { done: true, value: undefined as unknown as Date };
        }
        const day = days[cursor];
        cursor += 1;
        return {
          done: false,
          value: new Date(Date.UTC(year, month - 1, day))
        };
      }
    };
  }

  /**
   * Check if a given date has recordings
   * @param date - Date to check
   * @returns True if date matches year/month and has recordings
   */
  contains(date: Date): boolean {
    return date.getUTCFullYear() === this.year && date.getUTCMonth() + 1 === this.month && this.daysCache.includes(date.getUTCDate());
  }

  toString(): string {
    return `<VOD_search_status: year ${this.year}, month ${this.month}, days ${this.daysCache.join(",")}>`;
  }
}

/**
 * VOD trigger types as bit flags for recording triggers.
 * Multiple triggers can be combined using bitwise OR.
 * 
 * @example
 * ```typescript
 * const triggers = VODTrigger.MOTION | VODTrigger.PERSON;
 * if (triggers & VODTrigger.MOTION) {
 *   console.log("Motion detected");
 * }
 * ```
 */
export enum VODTrigger {
  /** No trigger */
  NONE = 0,
  /** Timer/scheduled recording */
  TIMER = 1 << 0,
  /** Motion detection */
  MOTION = 1 << 1,
  /** Vehicle detection (AI) */
  VEHICLE = 1 << 2,
  /** Animal detection (AI) */
  ANIMAL = 1 << 3,
  /** Person detection (AI) */
  PERSON = 1 << 4,
  /** Doorbell press */
  DOORBELL = 1 << 5,
  /** Package detection */
  PACKAGE = 1 << 6,
  /** Face detection */
  FACE = 1 << 7,
  /** IO trigger */
  IO = 1 << 8,
  /** Baby crying detection */
  CRYING = 1 << 9,
  /** Crossline detection */
  CROSSLINE = 1 << 10,
  /** Intrusion detection */
  INTRUSION = 1 << 11,
  /** Loitering detection */
  LINGER = 1 << 12,
  /** Forgotten item detection */
  FORGOTTEN_ITEM = 1 << 13,
  /** Taken item detection */
  TAKEN_ITEM = 1 << 14
}

export interface ParsedVODFileName {
  path: string;
  ext: string;
  date: Date;
  start: Date;
  end: Date;
  triggers: VODTrigger;
}

export interface VODDownload {
  length: number;
  filename: string;
  stream: Readable;
  close: () => void;
  etag?: string | null;
}

export class VODFile {
  private parsedName: ParsedVODFileName | null = null;
  bcTriggers: VODTrigger | null = null;

  constructor(private readonly data: Record<string, any>, private readonly tzinfo?: ReolinkTimezone) {}

  get type(): string {
    return this.data.type;
  }

  get startTime(): Date {
    return reolinkTimeToDate(this.data.StartTime, this.tzinfo);
  }

  get startTimeId(): string {
    return toReolinkTimeId(this.data.StartTime);
  }

  get endTime(): Date {
    return reolinkTimeToDate(this.data.EndTime, this.tzinfo);
  }

  get endTimeId(): string {
    return toReolinkTimeId(this.data.EndTime);
  }

  get playbackTime(): Date {
    return reolinkTimeToDate(this.data.PlaybackTime, undefined);
  }

  get duration(): number {
    return this.endTime.getTime() - this.startTime.getTime();
  }

  get fileName(): string {
    if ("name" in this.data) {
      return this.data.name;
    }
    const dt = this.playbackTime;
    return `${dt.getUTCFullYear()}${(dt.getUTCMonth() + 1).toString().padStart(2, "0")}${dt
      .getUTCDate()
      .toString()
      .padStart(2, "0")}${dt.getUTCHours().toString().padStart(2, "0")}${dt.getUTCMinutes().toString().padStart(2, "0")}${dt
      .getUTCSeconds()
      .toString()
      .padStart(2, "0")}`;
  }

  get size(): number {
    return Number(this.data.size);
  }

  get triggers(): VODTrigger {
    if (this.bcTriggers !== null) {
      return this.bcTriggers;
    }
    const parsed = this.ensureParsedFileName();
    if (!parsed) {
      return VODTrigger.NONE;
    }
    return parsed.triggers;
  }

  private ensureParsedFileName(): ParsedVODFileName | null {
    if (!("name" in this.data)) {
      return null;
    }
    if (!this.parsedName) {
      this.parsedName = parseFileName(this.data.name, this.tzinfo) ?? null;
    }
    return this.parsedName;
  }

  toString(): string {
    return `<VOD_file: ${this.type} stream, start ${this.startTime.toISOString()}, duration ${this.duration / 1000}s>`;
  }
}

type FlagDefinition = Record<string, readonly [number, number]>;

const FLAGS_CAM_V2: FlagDefinition = {
  resolution_index: [0, 7],
  tv_system: [7, 1],
  framerate: [8, 7],
  audio_index: [15, 2],
  ai_pd: [17, 1],
  ai_fd: [18, 1],
  ai_vd: [19, 1],
  ai_ad: [20, 1],
  encoder_type_index: [21, 2],
  is_schedule_record: [23, 1],
  is_motion_record: [24, 1],
  is_rf_record: [25, 1],
  is_doorbell_record: [26, 1],
  ai_other: [27, 1]
};

const FLAGS_HUB_V0: FlagDefinition = {
  resolution_index: [0, 7],
  tv_system: [7, 1],
  framerate: [8, 7],
  audio_index: [15, 2],
  ai_pd: [17, 1],
  ai_fd: [18, 1],
  ai_vd: [19, 1],
  ai_ad: [20, 1],
  encoder_type_index: [21, 2],
  is_schedule_record: [23, 1],
  is_motion_record: [24, 1],
  is_rf_record: [25, 1],
  is_doorbell_record: [26, 1],
  is_ai_other_record: [27, 1],
  picture_layout_index: [28, 7],
  package_delivered: [35, 1],
  package_takenaway: [36, 1]
};

const FLAGS_HUB_V1: FlagDefinition = {
  ...FLAGS_HUB_V0,
  package_event: [37, 1]
};

const FLAGS_HUB_V2: FlagDefinition = {
  resolution_index: [0, 7],
  tv_system: [7, 1],
  framerate: [8, 7],
  audio_index: [15, 2],
  ai_pd: [17, 1],
  ai_fd: [18, 1],
  ai_vd: [19, 1],
  ai_ad: [20, 1],
  ai_other: [21, 2],
  encoder_type_index: [23, 1],
  is_schedule_record: [24, 1],
  is_motion_record: [25, 1],
  is_rf_record: [26, 1],
  is_doorbell_record: [27, 1],
  picture_layout_index: [28, 7],
  package_delivered: [35, 1],
  package_takenaway: [36, 1],
  package_event: [37, 1],
  upload_flag: [38, 1]
};

export const FLAGS_LENGTH: Record<"cam" | "hub", Record<number, number>> = {
  cam: {
    2: 7,
    3: 7,
    4: 9,
    7: 10,
    9: 14,
    10: 14
  },
  hub: {
    2: 10
  }
};

export const FLAGS_MAPPING: Record<"cam" | "hub", Record<number, FlagDefinition>> = {
  cam: {
    2: FLAGS_CAM_V2,
    3: FLAGS_CAM_V2,
    4: FLAGS_CAM_V2,
    7: FLAGS_CAM_V2,
    9: FLAGS_CAM_V2,
    10: FLAGS_CAM_V2
  },
  hub: {
    0: FLAGS_HUB_V0,
    1: FLAGS_HUB_V1,
    2: FLAGS_HUB_V2
  }
};

export function decodeHexToFlags(hexValue: string, version: number, devType: "cam" | "hub"): Record<string, number> {
  const hexInt = Number.parseInt(hexValue, 16);
  const binary = hexInt.toString(2).padStart(hexValue.length * 4, "0");
  const reversedBinary = binary.split("").reverse().join("");

  const mapping = FLAGS_MAPPING[devType][version];
  if (!mapping) {
    throw new Error(`Unknown flags version ${version} for device type ${devType}`);
  }

  const flags: Record<string, number> = {};
  Object.entries(mapping).forEach(([flag, [bitPosition, bitSize]]) => {
    const segment = reversedBinary.slice(bitPosition, bitPosition + bitSize).split("").reverse().join("");
    flags[flag] = Number.parseInt(segment || "0", 2);
  });
  return flags;
}

export function parseFileName(fileName: string, tzInfo?: ReolinkTimezone): ParsedVODFileName | null {
  try {
    const [pathName, ext] = fileName.split(/\.(?=[^/.]+$)/);
    if (!ext) {
      debugLog("%s does not match known formats, no extension '.'", fileName);
      return null;
    }
    const name = pathName.split("/").pop() ?? pathName;
    const parts = name.split("_");

    if (!parts[0]?.startsWith("Rec") || parts[0].length !== 6) {
      debugLog("%s does not match known formats, could not find version", fileName);
      return null;
    }
    let version = Number.parseInt(parts[0].slice(4, 6), 16);

    let devType: "cam" | "hub" = "cam";
    let startDate: string;
    let startTime: string;
    let endTime: string;
    let hexValue: string;

    if (parts.length === 6) {
      [, startDate, startTime, endTime, hexValue] = parts;
    } else if (parts.length === 7) {
      [, startDate, startTime, endTime, , hexValue] = parts;
    } else if (parts.length === 9) {
      devType = "hub";
      [, startDate, startTime, endTime, , , , hexValue] = parts;
    } else {
      debugLog("%s does not match known formats, unknown length", fileName);
      return null;
    }

    if (!(version in FLAGS_MAPPING[devType])) {
      const versions = Object.keys(FLAGS_MAPPING[devType]).map((val) => Number(val));
      const newVersion = Math.max(...versions);
      debugLog(
        "%s has version %s, with hex length %s which is not yet known, using version %s instead",
        fileName,
        version,
        hexValue.length,
        newVersion
      );
      version = newVersion;
    }

    const expectedLength = FLAGS_LENGTH[devType][version];
    if (expectedLength && hexValue.length !== expectedLength) {
      debugLog(
        "%s with version %s has unexpected hex length %s, expected %s",
        fileName,
        version,
        hexValue.length,
        expectedLength
      );
    }

    const flagValues = decodeHexToFlags(hexValue, version, devType);

    let triggers = VODTrigger.NONE;
    if (flagValues.ai_pd) {
      triggers |= VODTrigger.PERSON;
    }
    if (flagValues.ai_vd) {
      triggers |= VODTrigger.VEHICLE;
    }
    if (flagValues.ai_ad) {
      triggers |= VODTrigger.ANIMAL;
    }
    if (flagValues.is_schedule_record) {
      triggers |= VODTrigger.TIMER;
    }
    if (flagValues.is_motion_record) {
      triggers |= VODTrigger.MOTION;
    }
    if (flagValues.is_doorbell_record) {
      triggers |= VODTrigger.DOORBELL;
    }
    if (flagValues.package_event) {
      triggers |= VODTrigger.PACKAGE;
    }

    const normalizedStartDate = startDate.toLowerCase().replace("dst", "");
    const start = reolinkTimeToDate(`${normalizedStartDate}${startTime}`, tzInfo);
    const end = endTime === "000000" ? start : reolinkTimeToDate(`${normalizedStartDate}${endTime}`, tzInfo);

    return {
      path: pathName,
      ext,
      date: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())),
      start,
      end,
      triggers
    };
  } catch (error) {
    debugLog("Error parsing VOD file name %s: %o", fileName, error);
    return null;
  }
}

export function vodTriggerFromFlags(flags: Record<string, number>): VODTrigger {
  let trigger = VODTrigger.NONE;
  if (flags.ai_pd) {
    trigger |= VODTrigger.PERSON;
  }
  if (flags.ai_vd) {
    trigger |= VODTrigger.VEHICLE;
  }
  if (flags.ai_ad) {
    trigger |= VODTrigger.ANIMAL;
  }
  if (flags.is_schedule_record) {
    trigger |= VODTrigger.TIMER;
  }
  if (flags.is_motion_record) {
    trigger |= VODTrigger.MOTION;
  }
  if (flags.is_doorbell_record) {
    trigger |= VODTrigger.DOORBELL;
  }
  if (flags.package_event) {
    trigger |= VODTrigger.PACKAGE;
  }
  return trigger;
}

export function parseVODFile(data: Record<string, any>, tzinfo?: ReolinkTimezone): VODFile {
  return new VODFile(data, tzinfo);
}

/**
 * PTZ preset information
 */
export interface PtzPreset {
  /** Preset ID */
  id: number;
  /** Preset name */
  name: string;
  /** Whether preset is enabled */
  enable: number;
}

/**
 * PTZ patrol information
 */
export interface PtzPatrol {
  /** Patrol ID */
  id: number;
  /** Patrol name */
  name: string;
  /** Whether patrol is enabled */
  enable: number;
}

/**
 * PTZ guard position settings
 */
export interface PtzGuard {
  /** Whether guard position is enabled */
  benable: number;
  /** Whether guard position exists */
  bexistPos: number;
  /** Timeout in seconds before returning to guard position */
  timeout: number;
}

/**
 * PTZ current position
 */
export interface PtzPosition {
  /** Pan position (0-3600) */
  Ppos?: number;
  /** Tilt position (0-900) */
  Tpos?: number;
}

/**
 * PTZ presets response from camera
 */
export interface PtzPresetsResponse {
  /** Array of presets */
  PtzPreset: PtzPreset[];
}

/**
 * PTZ patrols response from camera
 */
export interface PtzPatrolsResponse {
  /** Array of patrols */
  PtzPatrol: PtzPatrol[];
}

/**
 * PTZ guard response from camera
 */
export interface PtzGuardResponse {
  /** Guard position settings */
  PtzGuard: PtzGuard;
}

/**
 * PTZ current position response from camera
 */
export interface PtzCurPosResponse {
  /** Current position */
  PtzCurPos: PtzPosition;
}

/**
 * Auto-tracking settings
 */
export interface AutoTrackSettings {
  /** Channel number */
  channel?: number;
  /** Smart track enabled (legacy) */
  bSmartTrack?: number;
  /** AI track method */
  aiTrack?: number;
  /** Time before tracking stops after target disappears (seconds) */
  aiDisappearBackTime?: number;
  /** Time before camera stops and returns to guard (seconds) */
  aiStopBackTime?: number;
}

/**
 * Auto-tracking limit settings
 */
export interface AutoTrackLimits {
  /** PTZ trace section */
  PtzTraceSection: {
    /** Channel number */
    channel?: number;
    /** Left limit (0-2700, -1 = disabled) */
    LimitLeft: number;
    /** Right limit (0-2700, -1 = disabled) */
    LimitRight: number;
  };
}

