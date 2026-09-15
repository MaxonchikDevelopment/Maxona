import { PrismaClient, Prisma } from "@prisma/client";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { computeHrProfileFromArchive } from "../lib/dossier/compute-hr-from-archive";

const prisma = new PrismaClient();

function parseArgs(): Record<string, string | boolean> {
  const args = process.argv.slice(2);
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-zA-Z]+)(?:=(.+))?$/);
    if (!m) continue;
    if (m[1] === "apply") {
      result.apply = true;
      continue;
    }
    result[m[1]] = m[2] ?? args[++i] ?? "";
  }
  return result;
}

async function main() {
  const args = parseArgs();
  const login = typeof args.login === "string" ? args.login.toLowerCase().trim() : "";
  const archiveDir = typeof args.archive === "string" ? args.archive.trim() : "";
  const apply = args.apply === true;

  if (!login || !archiveDir) {
    console.error("Usage: tsx scripts/compute-hr-from-archive.ts --login <login> --archive <path> [--apply]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { login } });
  if (!user) {
    console.error(`Error: no user found with login "${login}"`);
    process.exit(1);
  }

  console.log(`Computing HR profile from archive: ${archiveDir}`);
  const result = await computeHrProfileFromArchive(archiveDir);

  console.log("\n=== HR profile result ===");
  console.log(`maxHr:               ${result.maxHr ?? "null"}`);
  console.log(`maxHrCandidateCount: ${result.maxHrCandidateCount}`);
  console.log(`lthrEstimate:        ${result.lthrEstimate ?? "null"}`);
  console.log(`lthrCandidateCount:  ${result.lthrCandidateCount}`);
  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  } else {
    console.log("\nWarnings: none");
  }

  if (!apply) {
    console.log("\nDry run only — nothing written. Re-run with --apply to write to the dossier.");
    return;
  }

  const existing = await prisma.athleteDossier.findUnique({ where: { userId: user.id } });
  const currentFacts = (existing?.facts as Record<string, unknown>) ?? {};

  const scratchDir = path.join(process.cwd(), "scratch");
  await mkdir(scratchDir, { recursive: true });
  const backupPath = path.join(
    scratchDir,
    `dossier-backup-${user.login}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await writeFile(backupPath, JSON.stringify({ userId: user.id, version: existing?.version ?? 0, facts: currentFacts }, null, 2));
  console.log(`\nBacked up current facts to: ${backupPath}`);

  const nowIso = new Date().toISOString();
  const updatedFacts: Record<string, unknown> = { ...currentFacts };

  if (result.maxHr != null) {
    updatedFacts.maxHr = result.maxHr;
    updatedFacts.maxHrSource = "computed";
    updatedFacts.maxHrComputedAt = nowIso;
    updatedFacts.maxHrCandidateCount = result.maxHrCandidateCount;
  }

  if (result.lthrEstimate != null) {
    updatedFacts.lthrEstimate = result.lthrEstimate;
    updatedFacts.lthrSource = "computed";
    updatedFacts.lthrComputedAt = nowIso;
    updatedFacts.lthrCandidateCount = result.lthrCandidateCount;
  } else {
    console.log("lthrEstimate is null — leaving any existing lthrEstimate/lthrSource untouched.");
  }

  const facts = updatedFacts as Prisma.InputJsonValue;

  const dossier = existing
    ? await prisma.athleteDossier.update({
        where: { userId: user.id },
        data: { facts, version: existing.version + 1 },
      })
    : await prisma.athleteDossier.create({
        data: { userId: user.id, facts, version: 1 },
      });

  console.log(`\nApplied. New dossier version: ${dossier.version}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
