import { promises as fs } from "node:fs";
import path from "node:path";

const DRAFT_DIR = path.join(process.cwd(), ".data", "drafts");
const DRAFT_FILE = path.join(DRAFT_DIR, "drafts.json");
const MAX_SERVER_DRAFTS = 40;

export async function listServerDrafts() {
  const drafts = await readDrafts();
  return drafts.sort(compareDraftUpdatedDesc);
}

export async function getServerDraft(id: string) {
  const drafts = await readDrafts();
  return drafts.find((draft) => draft.id === id) ?? null;
}

export async function saveServerDraft(record: Record<string, unknown>) {
  const draft = normalizeDraftRecord(record);
  const drafts = await readDrafts();
  const nextDrafts = [draft, ...drafts.filter((item) => item.id !== draft.id)]
    .sort(compareDraftUpdatedDesc)
    .slice(0, MAX_SERVER_DRAFTS);
  await writeDrafts(nextDrafts);
  return draft;
}

export async function deleteServerDraft(id: string) {
  const drafts = await readDrafts();
  const nextDrafts = drafts.filter((draft) => draft.id !== id);
  await writeDrafts(nextDrafts);
  return { deleted: nextDrafts.length !== drafts.length };
}

async function readDrafts(): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await fs.readFile(DRAFT_FILE, "utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraftRecordLike).map(normalizeDraftRecord);
  } catch {
    return [];
  }
}

async function writeDrafts(drafts: Array<Record<string, unknown>>) {
  await fs.mkdir(DRAFT_DIR, { recursive: true });
  await fs.writeFile(DRAFT_FILE, JSON.stringify(drafts, null, 2), "utf-8");
}

function normalizeDraftRecord(record: Record<string, unknown>) {
  const now = new Date().toISOString();
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : crypto.randomUUID();
  return {
    ...record,
    id,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 120) : "상세페이지 초안",
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : now
  };
}

function isDraftRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string");
}

function compareDraftUpdatedDesc(left: Record<string, unknown>, right: Record<string, unknown>) {
  return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
}
