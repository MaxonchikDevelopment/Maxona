import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/settings-client";
import type { StravaConnectionProp } from "@/components/strava-settings";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

export default async function SettingsPage() {
  const [user, stravaConn] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: USER_ID } }),
    prisma.stravaConnection.findUnique({ where: { userId: USER_ID } }),
  ]);

  const stravaConnection: StravaConnectionProp = stravaConn
    ? { stravaAthleteId: stravaConn.stravaAthleteId, createdAt: stravaConn.createdAt.toISOString() }
    : null;

  return (
    <SettingsClient
      initialConstraints={(user.constraints ?? {}) as Record<string, unknown>}
      userName={user.name}
      userTimezone={user.timezone}
      initialStravaConnection={stravaConnection}
    />
  );
}
