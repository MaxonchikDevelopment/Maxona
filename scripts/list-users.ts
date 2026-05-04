import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      login: true,
      name: true,
      preferredLanguage: true,
      timezone: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) {
    console.log("No users found.");
    return;
  }

  console.log(`${users.length} user(s):\n`);
  for (const u of users) {
    console.log(`  id:                ${u.id}`);
    console.log(`  login:             ${u.login ?? "(none)"}`);
    console.log(`  name:              ${u.name}`);
    console.log(`  preferredLanguage: ${u.preferredLanguage}`);
    console.log(`  timezone:          ${u.timezone}`);
    console.log(`  isActive:          ${u.isActive}`);
    console.log(`  createdAt:         ${u.createdAt.toISOString()}`);
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
