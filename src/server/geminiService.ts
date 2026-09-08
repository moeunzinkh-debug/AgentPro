import { GoogleGenAI } from '@google/genai';

export async function generateWithGemini(
  model: string,
  prompt: string,
  systemPrompt?: string,
  apiKey?: string
) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('No Gemini API key configured. Please set GEMINI_API_KEY in your environment or provide one in Settings.');
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const modelName = model || 'gemini-2.5-flash';

  const config: { systemInstruction?: string } = {};
  if (systemPrompt) {
    config.systemInstruction = systemPrompt;
  }

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config,
  });

  return response.text;
}
