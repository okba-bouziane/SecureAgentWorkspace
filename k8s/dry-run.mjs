// Validates the manifests with `kubectl apply --dry-run=client` and no cluster.
// kubectl still needs API discovery, so this serves a tiny stub of it for the resource kinds used here.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const res = (name, kind, namespaced = true) => ({ name, singularName: "", namespaced, kind, verbs: ["create", "get", "list", "patch", "update", "delete"] });
const groups = {
  "v1": { groupVersion: "v1", resources: [res("configmaps", "ConfigMap"), res("secrets", "Secret"), res("services", "Service")] },
  "apps/v1": { groupVersion: "apps/v1", resources: [res("deployments", "Deployment")] },
  "autoscaling/v2": { groupVersion: "autoscaling/v2", resources: [res("horizontalpodautoscalers", "HorizontalPodAutoscaler")] },
  "policy/v1": { groupVersion: "policy/v1", resources: [res("poddisruptionbudgets", "PodDisruptionBudget")] },
};
const apiGroups = Object.keys(groups).filter((g) => g !== "v1").map((g) => {
  const [name, version] = g.split("/");
  return { name, versions: [{ groupVersion: g, version }], preferredVersion: { groupVersion: g, version } };
});

const server = createServer((req, r) => {
  const path = (req.url ?? "").split("?")[0];
  r.setHeader("Content-Type", "application/json");
  if (path === "/api") return r.end(JSON.stringify({ kind: "APIVersions", versions: ["v1"] }));
  if (path === "/apis") return r.end(JSON.stringify({ kind: "APIGroupList", apiVersion: "v1", groups: apiGroups }));
  const key = path.replace(/^\/apis?\//, "");
  if (groups[key]) return r.end(JSON.stringify({ kind: "APIResourceList", ...groups[key] }));
  r.statusCode = 404;
  r.end("{}");
});

await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const dir = dirname(fileURLToPath(import.meta.url));
const files = ["configmap.yaml", "secret.example.yaml", "api.yaml", "worker.yaml", "hpa.yaml"].flatMap((f) => ["-f", f]);
const child = spawn("kubectl", [`--server=http://127.0.0.1:${server.address().port}`, "apply", "--dry-run=client", "--validate=false", ...files], {
  cwd: dir,
  env: { ...process.env, KUBECONFIG: "/dev/null" },
  stdio: "inherit",
});
child.on("exit", (code) => {
  server.close();
  process.exit(code ?? 1);
});
