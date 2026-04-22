import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

export default async function SettingsPage() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  return (
    <SettingsClient
      initialConstraints={(user.constraints ?? {}) as Record<string, unknown>}
      userName={user.name}
      userTimezone={user.timezone}
    />
  );
}
