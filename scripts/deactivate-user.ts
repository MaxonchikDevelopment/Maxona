import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-zA-Z]+)(?:=(.+))?$/);
    if (m) result[m[1]] = m[2] ?? args[++i] ?? "";
  }
  return result;
}

async function main() {
  const args = parseArgs();
  const login = args.login?.toLowerCase().trim();

  if (!login) {
    console.error("Error: --login is required");
    console.error("\nUsage: tsx scripts/deactivate-user.ts --login <login>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { login },
    select: { id: true, login: true, name: true, isActive: true },
  });

  if (!user) {
    console.error(`Error: user with login "${login}" not found`);
    process.exit(1);
  }

  if (!user.isActive) {
    console.log(`User "${login}" (${user.id}) is already inactive. Nothing changed.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: false },
  });

  console.log("User deactivated:");
  console.log(`  id:       ${user.id}`);
  console.log(`  login:    ${user.login}`);
  console.log(`  name:     ${user.name}`);
  console.log(`  isActive: false`);
  console.log("\nAll data (plans, sessions, Strava) is preserved.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
