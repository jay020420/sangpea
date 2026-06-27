import { getOperationalSnapshot } from "../../../../lib/server/operation-guards";
import { jsonNoStore } from "../../../../lib/server/api-guards";
import { getRuntimeEnvStatus } from "../../../../lib/server/runtime-env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return jsonNoStore({
    ok: true,
    timestamp: new Date().toISOString(),
    runtimeEnv: getRuntimeEnvStatus(),
    operations: getOperationalSnapshot()
  });
}
