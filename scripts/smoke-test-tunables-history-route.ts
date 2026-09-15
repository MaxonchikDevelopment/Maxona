/**
 * Smoke test for GET /api/tunables/history (Phase 3: read-only tunable
 * review history UI). Exercises the real route handler against two
 * throwaway synthetic users, plus a before/after check that user_maxon's
 * own TunableDefaults history is untouched (the route is read-only, but
 * verify anyway).
 *
 * Run with:  npx tsx --env-file=.env.local scripts/smoke-test-tunables-history-route.ts
 */

import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { GET } from "../app/api/tunables/history/route";
import { createSessionToken, SESSION_COOKIE } from "../lib/auth/session";

const prisma = new PrismaClient();

async function seedUser(loginSuffix: string) {
  return prisma.user.create({
    data: {
      name: `Synthetic Smoke Test User (tunables-history ${loginSuffix})`,
      login: `synthetic_smoke_tunableshistory_${loginSuffix}_${Date.now()}`,
      isActive: true,
      timezone: "Europe/Warsaw",
      constraints: { maxContinuousTrainingMinutes: 240 },
    },
  });
}

async function cleanupUser(userId: string) {
  await prisma.tunableDefaults.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function callRoute(userId: string) {
  const token = await createSessionToken(userId);
  const req = new NextRequest("http://localhost/api/tunables/history", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  const res = await GET(req);
  return (await res.json()) as { revisions: Array<Record<string, unknown>> };
}

async function main() {
  let exitCode = 0;
  const createdUserIds: string[] = [];

  try {
    // ---------- Confirm real user's TunableDefaults count before ----------
    const realUser = await prisma.user.findFirst({ where: { login: { not: { startsWith: "synthetic_" } } } });
    const realCountBefore = realUser ? await prisma.tunableDefaults.count({ where: { userId: realUser.id } }) : null;

    // ---------- Test 1: user with 3 revisions, distinct timestamps ----------
    console.log(`\n=== Test 1: 3 TunableDefaults rows → expect 3, newest-first ===`);
    const user1 = await seedUser("threerows");
    createdUserIds.push(user1.id);

    const now = Date.now();
    const rowsInput = [
      { hrDisciplinePct: 78, efStopThresholdPct: 7.5, jumpRatioCeiling: 1.08, rationale: "Oldest revision: initial defaults, not yet athlete-tuned.", revisedAt: new Date(now - 21 * 86400000) },
      { hrDisciplinePct: 80, efStopThresholdPct: 8.0, jumpRatioCeiling: 1.10, rationale: "Middle revision: decoupling trend improving, loosened jump ratio slightly.", revisedAt: new Date(now - 14 * 86400000) },
      { hrDisciplinePct: 82, efStopThresholdPct: 8.5, jumpRatioCeiling: 1.12, rationale: "Newest revision: sustained good EF trend over 2 weeks, raised HR discipline ceiling.", revisedAt: new Date(now - 7 * 86400000) },
    ];
    for (const row of rowsInput) {
      await prisma.tunableDefaults.create({ data: { userId: user1.id, ...row } });
    }

    const data1 = await callRoute(user1.id);
    if (data1.revisions.length !== 3) {
      console.log(`✗ FAIL: expected 3 revisions, got ${data1.revisions.length}`);
      exitCode = 1;
    } else {
      console.log(`✓ PASS: got 3 revisions`);
    }

    const revisedAtDescending = data1.revisions.every((r, i, arr) =>
      i === 0 || new Date(arr[i - 1].revisedAt as string).getTime() >= new Date(r.revisedAt as string).getTime()
    );
    if (revisedAtDescending) {
      console.log(`✓ PASS: ordered newest-first`);
    } else {
      console.log(`✗ FAIL: not ordered newest-first: ${JSON.stringify(data1.revisions.map((r) => r.revisedAt))}`);
      exitCode = 1;
    }

    const newest = data1.revisions[0];
    const expectedNewest = rowsInput[2];
    const fieldsMatch =
      newest.hrDisciplinePct === expectedNewest.hrDisciplinePct &&
      newest.efStopThresholdPct === expectedNewest.efStopThresholdPct &&
      newest.jumpRatioCeiling === expectedNewest.jumpRatioCeiling &&
      newest.rationale === expectedNewest.rationale;
    if (fieldsMatch) {
      console.log(`✓ PASS: newest row field values correct`);
    } else {
      console.log(`✗ FAIL: newest row field values wrong: ${JSON.stringify(newest)}`);
      exitCode = 1;
    }

    // ---------- Test 2: user with zero rows ----------
    console.log(`\n=== Test 2: zero TunableDefaults rows → expect empty array ===`);
    const user2 = await seedUser("zerorows");
    createdUserIds.push(user2.id);

    const data2 = await callRoute(user2.id);
    if (Array.isArray(data2.revisions) && data2.revisions.length === 0) {
      console.log(`✓ PASS: empty array returned, no error`);
    } else {
      console.log(`✗ FAIL: expected empty array, got ${JSON.stringify(data2)}`);
      exitCode = 1;
    }

    // ---------- Confirm real user's TunableDefaults count unaffected ----------
    if (realUser) {
      const realCountAfter = await prisma.tunableDefaults.count({ where: { userId: realUser.id } });
      if (realCountAfter === realCountBefore) {
        console.log(`\n✓ PASS: real user's TunableDefaults row count unaffected (${realCountBefore} → ${realCountAfter})`);
      } else {
        console.log(`\n✗ FAIL: real user's TunableDefaults row count changed (${realCountBefore} → ${realCountAfter})`);
        exitCode = 1;
      }
    } else {
      console.log(`\n(no real non-synthetic user found to check — skipping that assertion)`);
    }

    console.log(`\nRESULT: ${exitCode === 0 ? "PASS" : "FAIL"}`);
  } catch (err) {
    exitCode = 1;
    console.error(`\nRESULT: FAIL`);
    console.error(err);
  } finally {
    for (const userId of createdUserIds) {
      try {
        await cleanupUser(userId);
        console.log(`✓ Cleaned up synthetic user ${userId}`);
      } catch (cleanupErr) {
        console.error(`✗ Cleanup failed for ${userId}:`, cleanupErr);
      }
    }
    const remainingChecks = await Promise.all(
      createdUserIds.map(async (userId) => ({
        userId,
        userPresent: (await prisma.user.findUnique({ where: { id: userId } })) !== null,
        leftoverTunables: await prisma.tunableDefaults.count({ where: { userId } }),
      }))
    );
    console.log(`\n✓ Follow-up check: ${JSON.stringify(remainingChecks)}`);
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
