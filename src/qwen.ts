import axios from 'axios';
import 'dotenv/config';

const API_KEY = process.env.QWEN_API_KEY;
const URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

export async function callQwen(
  systemPrompt: string,
  userPrompt: string,
  model: string = 'qwen-plus'
): Promise<string> {
  if (!API_KEY) {
    throw new Error('Missing QWEN_API_KEY in environment variables.');
  }
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
        parameters: { result_format: 'message' },
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.output.choices[0].message.content;
  } catch (err: any) {
    console.error('Qwen API error:', err.response?.data || err.message);
    throw err;
  }
}
