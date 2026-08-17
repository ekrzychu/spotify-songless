import "dotenv/config";
import {
  backfillDerivedCategories,
  formatDecadeAssociationSummary,
} from "../src/lib/catalog/derived-categories";
import { db } from "../src/lib/db";

async function main(): Promise<void> {
  const summary = await backfillDerivedCategories();
  console.log(formatDecadeAssociationSummary(summary));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Decade category backfill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
