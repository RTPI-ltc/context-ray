import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { encode } from "gpt-tokenizer";
import matter from "gray-matter";
import { minimatch } from "minimatch";

export interface TextFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  bytes: number;
  lines: number;
  contentHash: string;
  truncated: boolean;
  symlink: boolean;
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function sourceId(agent: string, kind: string, relativePath: string, suffix = ""): string {
  return createHash("sha256")
    .update(`${agent}:${kind}:${toPosix(relativePath)}:${suffix}`)
    .digest("hex")
    .slice(0, 16);
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function estimateTokens(content: string): number {
  if (!content) return 0;
  try {
    return encode(content).length;
  } catch {
    return Math.ceil(Buffer.byteLength(content, "utf8") / 3.7);
  }
}

export async function resolveTargetDirectory(root: string, target = "."): Promise<string> {
  const absolute = path.resolve(root, target);
  try {
    const details = await stat(absolute);
    return details.isDirectory() ? absolute : path.dirname(absolute);
  } catch {
    return path.extname(absolute) ? path.dirname(absolute) : absolute;
  }
}

export function directoriesBetween(root: string, targetDirectory: string): string[] {
  const relative = path.relative(root, targetDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [root];
  const parts = relative === "" ? [] : relative.split(path.sep).filter(Boolean);
  const directories = [root];
  for (let index = 0; index < parts.length; index += 1) {
    directories.push(path.join(root, ...parts.slice(0, index + 1)));
  }
  return directories;
}

export async function readTextWithinRoot(
  root: string,
  absolutePath: string,
  maxBytes = 512_000,
): Promise<TextFile | null> {
  const normalizedRoot = await realpath(root);
  let resolved: string;
  let symlink = false;
  try {
    const linkDetails = await lstat(absolutePath);
    symlink = linkDetails.isSymbolicLink();
    resolved = await realpath(absolutePath);
  } catch {
    return null;
  }

  const relativeToRoot = path.relative(normalizedRoot, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;

  const buffer = await readFile(resolved);
  const truncated = buffer.byteLength > maxBytes;
  const limited = truncated ? buffer.subarray(0, maxBytes) : buffer;
  const content = limited.toString("utf8");
  return {
    absolutePath: resolved,
    relativePath: toPosix(path.relative(normalizedRoot, resolved)),
    content,
    bytes: buffer.byteLength,
    lines: content === "" ? 0 : content.split(/\r?\n/).length,
    contentHash: contentHash(content),
    truncated,
    symlink,
  };
}

export function parseFrontMatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  try {
    const parsed = matter(content);
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch {
    return { data: {}, body: content };
  }
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function matchesAny(target: string, patterns: string[]): boolean {
  const normalized = toPosix(target).replace(/^\.\//, "");
  return patterns.some((pattern) => {
    const candidate = pattern.trim();
    const options = { dot: true, matchBase: true, nocase: false } as const;
    return (
      minimatch(normalized, candidate, options) ||
      minimatch(`${normalized}/__context_ray_target__`, candidate, options)
    );
  });
}

export function pathWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .flatMap((part) => part.split(/[-_]+/))
      .filter((part) => part.length > 2),
  );
}

export function relevanceFor(
  content: string,
  sourcePath: string,
  target: string,
  task?: string,
): number {
  const queryWords = pathWords(`${target} ${task ?? ""}`);
  if (queryWords.size === 0) return 0.5;
  const documentWords = pathWords(`${sourcePath} ${content.slice(0, 20_000)}`);
  let overlap = 0;
  for (const word of queryWords) if (documentWords.has(word)) overlap += 1;
  return Math.min(1, overlap / Math.max(1, queryWords.size));
}

export function lineExcerpt(content: string, line: number): string {
  return content.split(/\r?\n/)[Math.max(0, line - 1)]?.trim().slice(0, 240) ?? "";
}
