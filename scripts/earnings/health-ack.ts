/**
 * Acknowledge a health problem that is being handled outside the pipeline,
 * so the hourly check lists it without failing (and emailing) until the
 * acknowledgment expires. Matching is by substring of the problem text.
 *
 *   npm run earnings:health-ack -- "wire feed gnw" --days 14 --note "asked GlobeNewswire for access"
 *   npm run earnings:health-ack -- --list
 *   npm run earnings:health-ack -- --clear "wire feed gnw"
 */
import { closePool, query } from "@/lib/earnings/db";
import { HEALTH_ACK_KEY, type HealthAck } from "@/lib/earnings/jobs";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

(async () => {
  const rows = await query<{ value: HealthAck[] }>(`select value from pipeline_state where key = $1`, [HEALTH_ACK_KEY]);
  let acks: HealthAck[] = (rows[0]?.value ?? []).filter((a) => a.until > new Date().toISOString());

  if (args.includes("--list")) {
    console.log(acks.length ? JSON.stringify(acks, null, 2) : "no acknowledgments");
  } else if (args.includes("--clear")) {
    const pattern = flag("--clear");
    acks = pattern ? acks.filter((a) => a.pattern !== pattern) : [];
    console.log(`cleared${pattern ? ` "${pattern}"` : " all"}; ${acks.length} left`);
  } else {
    const pattern = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--days" && args[args.indexOf(a) - 1] !== "--note");
    if (!pattern) throw new Error("usage: health-ack \"<problem text>\" [--days N] [--note \"...\"]");
    const days = Number(flag("--days") ?? 14);
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    acks = [...acks.filter((a) => a.pattern !== pattern), { pattern, until, note: flag("--note") }];
    console.log(`acknowledged "${pattern}" until ${until.slice(0, 10)}`);
  }

  await query(
    `insert into pipeline_state (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [HEALTH_ACK_KEY, JSON.stringify(acks)]
  );
  await closePool();
})();
