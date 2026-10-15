import "dotenv/config";
import { writeFileSync } from "node:fs";
import { seed } from "../src/logic";

const ID = "n_maplenagar", NAME = "Maple Nagar (fictional demo)";
const doc = JSON.stringify(seed());

if (process.argv.includes("--sql")) {
  const sql = `insert into neighborhoods (id, kind, name, center_lat, center_lng, radius_m, doc)
values ('${ID}', 'named', '${NAME}', 28.5663, 77.2115, 1200, $json$${doc}$json$::jsonb)
on conflict (id) do update set doc = excluded.doc, version = neighborhoods.version + 1;
`;
  writeFileSync(new URL("../database/seed.sql", import.meta.url), sql);
  console.log("Wrote database/seed.sql");
} else {
  const { pool } = await import("./db");
  await pool.query(
    "insert into neighborhoods (id, kind, name, center_lat, center_lng, radius_m, doc) values ($1, 'named', $2, 28.5663, 77.2115, 1200, $3) on conflict (id) do update set doc = excluded.doc, version = neighborhoods.version + 1",
    [ID, NAME, doc],
  );
  console.log(`Seeded "${NAME}" (fictional, clearly labeled). Find it with the neighborhood search and join it.`);
  await pool.end();
}
