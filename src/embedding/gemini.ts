import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { MODEL_CONFIG } from "../config/model.js";
import { throttleEmbedding, throttleGenerateContent } from "../config/rateLimit.js";

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

export async function generateTextEmbedding(text: string): Promise<number[]> {
  await throttleEmbedding();
  const response = await getClient().models.embedContent({
    model: MODEL_CONFIG.embedding,
    contents: text,
  });

  const values = response.embeddings?.[0]?.values;
  if (!values) {
    throw new Error("Gemini embedContent returned no embedding values");
  }
  return values;
}

export interface DescribeImageInput {
  imageUrl?: string;
  imageBase64?: string;
  imagePath?: string;
}

// Captions an image via the vision-capable text model, since embedContent is text-only.
// Exactly one of imageUrl/imageBase64/imagePath must be given; imageUrl is fetched and
// imagePath is read from local disk, both inlined as base64 bytes.
export async function describeImage(input: DescribeImageInput): Promise<string> {
  const { mimeType, data } = await resolveImageBytes(input);

  await throttleGenerateContent();
  const response = await getClient().models.generateContent({
    model: MODEL_CONFIG.text,
    contents: [
      {
        text:
          "Describe this product image in 2-3 concise sentences for a product search index. " +
          "Mention visible category, type, color, material, and any distinguishing features. " +
          "Do not speculate about brand or price.",
      },
      { inlineData: { mimeType, data } },
    ],
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini generateContent returned no caption text");
  }
  return text.trim();
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
    const mimeType = EXT_MIME_TYPES[path.extname(input.imagePath).toLowerCase()] ?? "image/jpeg";
    const buffer = readFileSync(input.imagePath);
    return { mimeType, data: buffer.toString("base64") };
  }

  throw new Error("describeImage requires one of imageUrl, imageBase64, or imagePath");
}
