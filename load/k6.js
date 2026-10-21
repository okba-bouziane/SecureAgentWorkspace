// k6 load test: same scenarios as autocannon.mjs plus a ramp. Run with:
//   k6 run -e API_URL=http://localhost:3001 -e KEYCLOAK_URL=http://localhost:8081 k6.js
import http from "k6/http";
import { check, sleep } from "k6";

const API = __ENV.API_URL || "http://localhost:3001";
const KC = __ENV.KEYCLOAK_URL || "http://localhost:8081";

export const options = {
  scenarios: {
    search: {
      executor: "ramping-vus",
      stages: [
        { duration: "20s", target: 20 },
        { duration: "40s", target: 20 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:search}": ["p(95)<500"],
    "http_req_duration{endpoint:health}": ["p(95)<50"],
  },
};

export function setup() {
  const res = http.post(`${KC}/realms/securemcp/protocol/openid-connect/token`, {
    grant_type: "password",
    client_id: "saw-web",
    username: "viewer",
    password: "viewer",
  });
  check(res, { "token issued": (r) => r.status === 200 });
  return { token: res.json("access_token") };
}

const questions = ["how long do customers have to return a keyboard", "express shipping cost", "what does the status pending mean", "who can change an order status"];

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  const q = questions[Math.floor(Math.random() * questions.length)];
  const search = http.get(`${API}/knowledge/search?k=5&q=${encodeURIComponent(q)}`, { headers, tags: { endpoint: "search" } });
  check(search, { "search 200": (r) => r.status === 200, "has hits": (r) => r.json("hits").length > 0 });
  const health = http.get(`${API}/health`, { tags: { endpoint: "health" } });
  check(health, { "health 200": (r) => r.status === 200 });
  sleep(0.2);
}
