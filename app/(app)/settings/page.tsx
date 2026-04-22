import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

export default async function SettingsPage() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  return (
    <main className="p-4 space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-400">Name</p>
        <p>{user.name}</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-400">Timezone</p>
        <p>{user.timezone}</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-400">Constraints</p>
        <pre className="rounded bg-gray-50 p-2 text-xs">
          {JSON.stringify(user.constraints, null, 2)}
        </pre>
      </div>
      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="w-full rounded border py-2 text-sm text-red-500"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
