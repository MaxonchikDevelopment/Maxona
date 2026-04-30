const STRAVA_API = "https://www.strava.com/api/v3";

export type StravaStreamData = {
  time: number[];
  heartrate: number[];
  distance: number[];
  velocitySmooth: number[];
  altitude: number[];
  cadence?: number[];
  watts?: number[];
};

type RawStreamEntry = {
  type: string;
  data: unknown[];
  series_type: string;
  original_size: number;
  resolution: string;
};

function extractNumbers(entry: RawStreamEntry | undefined): number[] {
  if (!entry || !Array.isArray(entry.data)) return [];
  return entry.data.filter((v): v is number => typeof v === "number");
}

export async function fetchActivityStreams(
  stravaExternalId: string,
  accessToken: string
): Promise<StravaStreamData | null> {
  const keys = "time,heartrate,distance,velocity_smooth,altitude,cadence,watts";
  const url = `${STRAVA_API}/activities/${stravaExternalId}/streams?keys=${keys}&key_by_type=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Strava streams fetch failed (${res.status})`);

  const raw: Record<string, RawStreamEntry> = await res.json();

  const cadenceData = extractNumbers(raw["cadence"]);
  const wattsData = extractNumbers(raw["watts"]);

  return {
    time: extractNumbers(raw["time"]),
    heartrate: extractNumbers(raw["heartrate"]),
    distance: extractNumbers(raw["distance"]),
    velocitySmooth: extractNumbers(raw["velocity_smooth"]),
    altitude: extractNumbers(raw["altitude"]),
    ...(cadenceData.length > 0 ? { cadence: cadenceData } : {}),
    ...(wattsData.length > 0 ? { watts: wattsData } : {}),
  };
}
