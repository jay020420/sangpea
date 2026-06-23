import { promises as fs } from "node:fs";
import path from "node:path";

const KNOWLEDGE_DIR = path.join(process.cwd(), ".data", "knowledge");
const KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, "documents.json");
const MAX_CHUNKS_PER_DOCUMENT = 2;

export type KnowledgeDocument = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
};

export type RetrievedKnowledge = {
  documentId: string;
  sourceName: string;
  content: string;
  score: number;
};

type KnowledgeChunk = {
  content: string;
  kind: "body" | "keywords";
};

export async function getKnowledgeStats() {
  const documents = await readDocuments();
  return {
    configured: true,
    documents: documents.length,
    chunks: documents.reduce((total, document) => total + chunkDocument(document.text).length, 0)
  };
}

export async function listKnowledgeDocuments() {
  const documents = await readDocuments();
  return documents.map(({ id, name, text, createdAt }) => ({
    id,
    name,
    createdAt,
    size: text.length
  }));
}

export async function indexKnowledgeDocument({ name, text }: { name: string; text: string }) {
  const documents = await readDocuments();
  const cleaned = cleanKnowledgeText(text);
  if (!cleaned) return { indexed: false, chunks: 0, reason: "No text to index." };
  const normalizedName = name.trim() || "knowledge-file";
  const existing = documents.find((document) => document.name === normalizedName);

  const document: KnowledgeDocument = {
    id: existing?.id ?? crypto.randomUUID(),
    name: normalizedName,
    text: cleaned.slice(0, 200000),
    createdAt: existing?.createdAt ?? new Date().toISOString()
  };

  await writeDocuments([document, ...documents.filter((item) => item.id !== document.id && item.name !== document.name)].slice(0, 80));
  return { indexed: true, chunks: chunkDocument(document.text).length, documentId: document.id };
}

export async function deleteKnowledgeDocument(documentId: string) {
  const documents = await readDocuments();
  const nextDocuments = documents.filter((document) => document.id !== documentId);
  await writeDocuments(nextDocuments);
  return { deleted: nextDocuments.length !== documents.length };
}

export async function retrieveKnowledge(query: string, limit = 8): Promise<RetrievedKnowledge[]> {
  const documents = await readDocuments();
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];

  const rows: RetrievedKnowledge[] = [];
  for (const document of documents) {
    for (const chunk of chunkDocument(document.text)) {
      const score = scoreChunk(queryTerms, chunk);
      if (score > 0) {
        rows.push({
          documentId: document.id,
          sourceName: document.name,
          content: chunk.content,
          score
        });
      }
    }
  }

  return diversifyRows(rows, limit);
}

export async function buildKnowledgeContext(query: string, fallbackText = "") {
  const { text } = await buildKnowledgeContextWithSources(query, fallbackText);
  return text;
}

export async function buildKnowledgeContextWithSources(query: string, fallbackText = "") {
  const retrieved = await retrieveKnowledge(query, 8);
  const fallback = fallbackText.trim();
  if (!retrieved.length) {
    return {
      text: fallback.slice(0, 60000),
      sources: [] as string[]
    };
  }

  const ragText = retrieved
    .map((item, index) =>
      [`# RAG search result ${index + 1}: ${item.sourceName}`, `score: ${item.score.toFixed(2)}`, item.content].join("\n")
    )
    .join("\n\n");
  const fallbackBlock = fallback ? `# Required stage/user context\n${fallback}\n\n` : "";

  return {
    text: `${fallbackBlock}${ragText}`.slice(0, 60000),
    sources: Array.from(new Set(retrieved.map((item) => item.sourceName)))
  };
}

async function readDocuments(): Promise<KnowledgeDocument[]> {
  try {
    const text = await fs.readFile(KNOWLEDGE_FILE, "utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKnowledgeDocument);
  } catch {
    return [];
  }
}

async function writeDocuments(documents: KnowledgeDocument[]) {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  await fs.writeFile(KNOWLEDGE_FILE, JSON.stringify(documents, null, 2), "utf-8");
}

function cleanKnowledgeText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkDocument(text: string) {
  const normalized = cleanKnowledgeText(text);
  const sections = splitMarkdownSections(normalized);
  const chunks = sections.flatMap((section) => splitLongSection(section));
  if (chunks.length) return chunks.slice(0, 120);

  return splitLongSection({ heading: "", content: normalized, kind: "body" }).slice(0, 120);
}

function splitMarkdownSections(text: string) {
  const lines = text.split("\n");
  const sections: Array<{ heading: string; content: string; kind: KnowledgeChunk["kind"] }> = [];
  let heading = "";
  let buffer: string[] = [];

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      pushSection();
      heading = line.replace(/^##\s+/, "").trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  pushSection();
  return sections.filter((section) => section.content.replace(/\s+/g, " ").trim().length >= 80);

  function pushSection() {
    const content = buffer.join("\n").trim();
    if (!content) return;
    sections.push({
      heading,
      content,
      kind: isKeywordHeading(heading) ? "keywords" : "body"
    });
  }
}

function splitLongSection(section: { heading: string; content: string; kind: KnowledgeChunk["kind"] }): KnowledgeChunk[] {
  const compact = section.content.replace(/\n{3,}/g, "\n\n").trim();
  if (compact.length < 80) return [];
  if (compact.length <= 1800) return [{ content: compact, kind: section.kind }];

  const prefix = section.heading ? `## ${section.heading}\n\n` : "";
  const paragraphs = compact
    .replace(/^##\s+.+\n*/, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: KnowledgeChunk[] = [];
  let current = prefix;

  for (const paragraph of paragraphs) {
    const next = current.trim() ? `${current.trim()}\n\n${paragraph}` : paragraph;
    if (next.length > 1800 && current.trim().length >= 80) {
      chunks.push({ content: current.trim(), kind: section.kind });
      current = `${prefix}${paragraph}`;
    } else {
      current = next;
    }
  }

  if (current.trim().length >= 80) chunks.push({ content: current.trim(), kind: section.kind });
  if (chunks.length) return chunks;

  const normalized = compact.replace(/\s+/g, " ").trim();
  const fallbackChunks: KnowledgeChunk[] = [];
  const size = 1400;
  const overlap = 180;
  for (let start = 0; start < normalized.length; start += size - overlap) {
    const chunk = normalized.slice(start, start + size).trim();
    if (chunk.length >= 80) fallbackChunks.push({ content: chunk, kind: section.kind });
    if (fallbackChunks.length >= 120) break;
  }
  return fallbackChunks;
}

function scoreChunk(queryTerms: string[], chunk: KnowledgeChunk) {
  const terms = tokenize(chunk.content);
  if (!terms.length) return 0;
  const frequency = new Map<string, number>();
  for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const count = frequency.get(term) ?? 0;
    if (count > 0) score += 1 + Math.log(count);
  }
  const normalizedScore = score / Math.sqrt(terms.length / 100);
  return chunk.kind === "keywords" ? normalizedScore * 0.35 : normalizedScore * 1.08;
}

function diversifyRows(rows: RetrievedKnowledge[], limit: number) {
  const sorted = rows.sort((left, right) => right.score - left.score);
  const countsByDocument = new Map<string, number>();
  const selected: RetrievedKnowledge[] = [];

  for (let pass = 1; pass <= MAX_CHUNKS_PER_DOCUMENT; pass += 1) {
    for (const row of sorted) {
      const count = countsByDocument.get(row.documentId) ?? 0;
      if (count >= pass) continue;
      selected.push(row);
      countsByDocument.set(row.documentId, count + 1);
      if (selected.length >= limit) return selected;
    }
  }

  return selected;
}

function isKeywordHeading(heading: string) {
  const normalized = heading.toLowerCase();
  return (
    normalized.includes("검색 키워드") ||
    normalized.includes("검색키워드") ||
    normalized.includes("키워드") ||
    normalized.includes("keywords") ||
    normalized.includes("search terms")
  );
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function isKnowledgeDocument(value: unknown): value is KnowledgeDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.text === "string";
}
