import axios from 'axios';
import 'dotenv/config';

const API_KEY = process.env.QWEN_API_KEY;
const URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 120_000;

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface QwenResult {
  content: string;
  usage: LlmUsage;
}

export interface QwenOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

function isRetryable(err: any): boolean {
  const status = err?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  // Network-level errors (timeouts, DNS, resets) have no HTTP status.
  return status === undefined;
}

export async function callQwen(
  systemPrompt: string,
  userPrompt: string,
  options: QwenOptions = {}
): Promise<QwenResult> {
  if (!API_KEY) {
    throw new Error('Missing QWEN_API_KEY in environment variables.');
  }
  const model = options.model || 'qwen-plus';

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        URL,
        {
          model,
          input: {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          },
          parameters: {
            result_format: 'message',
            temperature: options.temperature ?? 0.3,
            ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: REQUEST_TIMEOUT_MS,
        }
      );
      return {
        content: response.data.output.choices[0].message.content,
        usage: {
          inputTokens: response.data.usage?.input_tokens ?? 0,
          outputTokens: response.data.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        const delayMs = 500 * Math.pow(2, attempt);
        console.warn(`Qwen API retry ${attempt + 1}/${MAX_RETRIES} (${model}) in ${delayMs}ms: ${err.message}`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      console.error('Qwen API error:', err.response?.data || err.message);
      throw err;
    }
  }
  throw lastError;
}
