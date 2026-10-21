// Load test with autocannon against a running stack. It never calls the LLM:
// it measures health, authenticated hybrid search (embedding + full-text + pgvector + RRF + rerank) and trace listing.
//
//   API_URL=http://localhost:3001 KEYCLOAK_URL=http://localhost:8081 node autocannon.mjs
import autocannon from "autocannon";
import { writeFileSync } from "node:fs";

const API = process.env.API_URL ?? "http://localhost:3001";
const KC = process.env.KEYCLOAK_URL ?? "http://localhost:8081";
const DURATION = Number(process.env.DURATION ?? 15);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);

async function token(user) {
  const res = await fetch(`${KC}/realms/securemcp/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "saw-web", username: user, password: user }),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return (await res.json()).access_token;
}

const bearer = { authorization: `Bearer ${await token("viewer")}` };
const questions = ["how long do customers have to return a keyboard", "express shipping cost", "what does the status pending mean", "who can change an order status", "when is a parcel considered lost"];

const scenarios = [
  { name: "GET /health", options: { url: `${API}/health` } },
  { name: "GET /health/ready (Postgres + Redis ping)", options: { url: `${API}/health/ready` } },
  {
    name: "GET /knowledge/search (hybrid search)",
    options: {
      requests: questions.map((q) => ({ method: "GET", path: `/knowledge/search?k=5&q=${encodeURIComponent(q)}`, headers: bearer })),
      url: API,
    },
  },
  { name: "GET /traces (auth + SQL aggregate)", options: { url: `${API}/traces?limit=20`, headers: bearer } },
];

const rows = [];
for (const s of scenarios) {
  process.stdout.write(`Running ${s.name} for ${DURATION}s with ${CONNECTIONS} connections... `);
  const r = await autocannon({ connections: CONNECTIONS, duration: DURATION, ...s.options });
  const row = {
    scenario: s.name,
    reqPerSec: Math.round(r.requests.average),
    latencyMsP50: r.latency.p50,
    latencyMsP97_5: r.latency.p97_5,
    latencyMsP99: r.latency.p99,
    latencyMsMax: r.latency.max,
    total2xx: r["2xx"],
    errors: r.errors + r.timeouts + r.non2xx,
  };
  rows.push(row);
  console.log(`${row.reqPerSec} req/s, p50 ${row.latencyMsP50} ms, p99 ${row.latencyMsP99} ms, errors ${row.errors}`);
}

console.table(rows);
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), duration: DURATION, connections: CONNECTIONS, rows }, null, 2));
