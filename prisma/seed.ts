import { PrismaClient, DayOfWeek } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const ownerLogin = process.env.OWNER_LOGIN ?? "maxon";
  const rawPassword =
    process.env.OWNER_PASSWORD ?? process.env.AUTH_PASSWORD ?? "MaxonaLocal2026!";
  const passwordHash = await hash(rawPassword, 12);

  const user = await prisma.user.upsert({
    where: { id: "user_maxon" },
    update: {
      login: ownerLogin,
      passwordHash,
      isActive: true,
      preferredLanguage: "en",
    },
    create: {
      id: "user_maxon",
      name: "Maxon",
      login: ownerLogin,
      passwordHash,
      isActive: true,
      preferredLanguage: "en",
      timezone: "Europe/Warsaw",
      constraints: {
        maxContinuousTrainingMinutes: 240,
      },
    },
  });

  const windows: {
    dayOfWeek: DayOfWeek;
    timeStartMin: number;
    timeEndMin: number;
  }[] = [
    { dayOfWeek: "mon", timeStartMin: 360, timeEndMin: 480 },
    { dayOfWeek: "mon", timeStartMin: 1080, timeEndMin: 1260 },
    { dayOfWeek: "tue", timeStartMin: 360, timeEndMin: 480 },
    { dayOfWeek: "tue", timeStartMin: 1080, timeEndMin: 1260 },
    { dayOfWeek: "wed", timeStartMin: 1080, timeEndMin: 1200 }, // office day — reduced
    { dayOfWeek: "thu", timeStartMin: 360, timeEndMin: 480 },
    { dayOfWeek: "thu", timeStartMin: 1080, timeEndMin: 1260 },
    { dayOfWeek: "fri", timeStartMin: 360, timeEndMin: 480 },
    { dayOfWeek: "fri", timeStartMin: 1080, timeEndMin: 1260 },
    { dayOfWeek: "sat", timeStartMin: 480, timeEndMin: 720 },
    { dayOfWeek: "sun", timeStartMin: 480, timeEndMin: 720 },
  ];

  await prisma.availabilityWindow.deleteMany({ where: { userId: user.id } });
  await prisma.availabilityWindow.createMany({
    data: windows.map((w) => ({ ...w, userId: user.id })),
  });

  console.log("Seed complete — user:", user.id, "login:", user.login);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
