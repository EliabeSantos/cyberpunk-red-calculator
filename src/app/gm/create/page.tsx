import { Suspense } from "react";
import GMShell from "@/components/gm/GMShell";
import CreateEnemyPageClient from "./CreateEnemyPageClient";

export default function CreateEnemyPage() {
  return (
    <GMShell>
      <Suspense>
        <CreateEnemyPageClient />
      </Suspense>
    </GMShell>
  );
}