import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

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
  const password = args.password;
  const name = args.name?.trim();
  const timezone = args.timezone?.trim() || "Europe/Berlin";
  const language = args.language?.trim() || "en";

  const errors: string[] = [];
  if (!login) errors.push("--login is required");
  if (!password) errors.push("--password is required");
  else if (password.length < 10) errors.push("--password must be at least 10 characters");
  if (!name) errors.push("--name is required");
  if (!["en", "ru", "uk"].includes(language)) errors.push("--language must be one of: en, ru, uk");

  if (errors.length > 0) {
    for (const e of errors) console.error(`Error: ${e}`);
    console.error(
      "\nUsage: tsx scripts/add-beta-user.ts --login <login> --password <pass> --name <name> [--timezone <tz>] [--language en|ru|uk]",
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    console.error(`Error: login "${login}" already exists (id: ${existing.id})`);
    process.exit(1);
  }

  const passwordHash = await hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name: name!,
      login,
      passwordHash,
      isActive: true,
      preferredLanguage: language,
      timezone,
      constraints: {
        maxContinuousTrainingMinutes: 240,
      },
    },
    select: {
      id: true,
      login: true,
      name: true,
      timezone: true,
      preferredLanguage: true,
      isActive: true,
      createdAt: true,
    },
  });

  console.log("Beta user created:");
  console.log(`  id:                ${user.id}`);
  console.log(`  login:             ${user.login}`);
  console.log(`  name:              ${user.name}`);
  console.log(`  timezone:          ${user.timezone}`);
  console.log(`  preferredLanguage: ${user.preferredLanguage}`);
  console.log(`  isActive:          ${user.isActive}`);
  console.log(`  createdAt:         ${user.createdAt.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
