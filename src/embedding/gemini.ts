import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { MODEL_CONFIG } from "../config/model.js";

const EXT_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

let client: GoogleGenAI | undefined;

// Lazy singleton — avoids throwing at import time when GEMINI_API_KEY isn't set yet.
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.geminiApiKey() });
  }
  return client;
}

export interface DescribeImageInput {
  imageUrl?: string;
  imageBase64?: string;
  imagePath?: string;
}

export interface EmbedInput {
  text?: string;
  image?: DescribeImageInput;
}

// gemini-embedding-2 is natively multimodal — text and image parts go into one embedContent
// call and land in the same vector space, no separate captioning step needed.
export async function generateEmbedding(input: EmbedInput): Promise<number[]> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (input.text) {
    parts.push({ text: input.text });
  }
  if (input.image) {
    const { mimeType, data } = await resolveImageBytes(input.image);
    parts.push({ inlineData: { mimeType, data } });
  }
  if (parts.length === 0) {
    throw new Error("generateEmbedding requires at least one of text or image");
  }

  const response = await getClient().models.embedContent({
    model: MODEL_CONFIG.embedding,
    contents: parts,
  });

  const values = response.embeddings?.[0]?.values;
  if (!values) {
    throw new Error("Gemini embedContent returned no embedding values");
  }
  return values;
}

// Resolves any supported image input (raw base64, data: URI, local path, or URL) to a single
// data: URI. Tools call this at the MCP boundary so an agent can pass a path or URL instead of
// inlining hundreds of kilobytes of base64 into a tool argument, while everything downstream
// keeps handling one inline representation.
export async function resolveImageToDataUri(input: DescribeImageInput): Promise<string> {
  const { mimeType, data } = await resolveImageBytes(input);
  return `data:${mimeType};base64,${data}`;
}

async function resolveImageBytes(input: DescribeImageInput): Promise<{ mimeType: string; data: string }> {
  if (input.imageBase64) {
    // Accept either a raw base64 string or a data: URI.
    const match = /^data:(.+?);base64,(.*)$/s.exec(input.imageBase64);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
    return { mimeType: "image/jpeg", data: input.imageBase64 };
  }

  if (input.imageUrl) {
    const res = await fetch(input.imageUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch image from ${input.imageUrl}: ${res.status} ${res.statusText}`);
    }
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { mimeType, data: buffer.toString("base64") };
  }

  if (input.imagePath) {
    // Relative paths resolve against the server's cwd (the repo root, per .mcp.json).
    const resolved = path.resolve(input.imagePath);
    if (!existsSync(resolved)) {
      throw new Error(`Image file not found: ${resolved} (from imagePath "${input.imagePath}")`);
    }
    const mimeType = EXT_MIME_TYPES[path.extname(resolved).toLowerCase()] ?? "image/jpeg";
    const buffer = readFileSync(resolved);
    return { mimeType, data: buffer.toString("base64") };
  }

  throw new Error("resolveImageBytes requires one of imageUrl, imageBase64, or imagePath");
}
