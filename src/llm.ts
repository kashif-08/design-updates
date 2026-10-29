// Model access. Two ways in:
// - api:    the Anthropic Messages API with ANTHROPIC_API_KEY (what GitHub Actions uses).
// - manual: no key and no spend. Each question is saved to .cache/llm/requests/<key>.json and the run stops;
//           once someone writes the answer to .cache/llm/answers/<key>.json, the next run picks it up.
//           Web search is not available in this mode.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallUsage } from './types.ts';

export interface ContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface MessagesRequest {
  model: string;
  system: string;
  messages: Message[];
  maxTokens: number;
  tools?: unknown[];
}

export interface MessagesResponse {
  content: ContentBlock[];
  stopReason: string;
  usage: { input_tokens: number; output_tokens: number; web_searches: number };
}

export interface Llm {
  readonly mode: 'api' | 'manual';
  messages(req: MessagesRequest): Promise<MessagesResponse>;
  readonly canSearch: boolean;
}

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

export class AnswerPendingError extends Error {
  readonly requestPath: string;
  constructor(message: string, requestPath: string) {
    super(message);
    this.name = 'AnswerPendingError';
    this.requestPath = requestPath;
  }
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function apiLlm(apiKey: string, fetchImpl: typeof fetch = fetch, sleep: Sleep = realSleep, baseUrl = 'https://api.anthropic.com'): Llm {
  return {
    mode: 'api',
    canSearch: true,
    async messages(req) {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: req.model,
              max_tokens: req.maxTokens,
              system: req.system,
              messages: req.messages,
              ...(req.tools ? { tools: req.tools } : {}),
            }),
            signal: AbortSignal.timeout(300_000),
          });
        } catch (err) {
          if (attempt < 3) {
            await sleep(3000 * 2 ** attempt);
            continue;
          }
          throw new Error(`Anthropic API unreachable: ${(err as Error).message}`);
        }
        if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
          await sleep(3000 * 2 ** attempt);
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new LlmUnavailableError(`Anthropic API rejected the key (HTTP ${res.status}). Check ANTHROPIC_API_KEY.`);
        if (!res.ok) throw new Error(`Anthropic API returned HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
        const data = (await res.json()) as {
          content?: ContentBlock[];
          stop_reason?: string;
          usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
        };
        return {
          content: data.content ?? [],
          stopReason: data.stop_reason ?? 'end_turn',
          usage: {
            input_tokens: data.usage?.input_tokens ?? 0,
            output_tokens: data.usage?.output_tokens ?? 0,
            web_searches: data.usage?.server_tool_use?.web_search_requests ?? 0,
          },
        };
      }
    },
  };
}

export function manualLlm(dir: string): Llm {
  return {
    mode: 'manual',
    canSearch: false,
    async messages(req) {
      if (req.tools?.length) throw new LlmUnavailableError('web search needs the API; manual mode skips it');
      const user = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
      const key = createHash('sha256').update(`${req.system}\n\n${user}`).digest('hex').slice(0, 16);
      const answer = join(dir, 'answers', `${key}.json`);
      if (existsSync(answer)) {
        return { content: [{ type: 'text', text: readFileSync(answer, 'utf8') }], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0, web_searches: 0 } };
      }
      mkdirSync(join(dir, 'requests'), { recursive: true });
      mkdirSync(join(dir, 'answers'), { recursive: true });
      const requestPath = join(dir, 'requests', `${key}.json`);
      writeFileSync(requestPath, JSON.stringify({ key, answer_to: answer, system: req.system, user }, null, 2));
      throw new AnswerPendingError(`waiting for an answer to ${key}`, requestPath);
    },
  };
}

export const textOf = (blocks: ContentBlock[]): string =>
  blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

export function usageOf(step: string, model: string, r: MessagesResponse): CallUsage {
  return { step, model, ...r.usage };
}
