import logger from '../utils/logger.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'phi3:mini';

export async function queryOllama(prompt, { temperature = 0.1, format = 'json' } = {}) {
  const body = {
    model: MODEL,
    prompt,
    stream: false,
    options: { temperature },
  };

  if (format === 'json') {
    body.format = 'json';
  }

  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const response = data.response.trim();

  if (format === 'json') {
    try {
      return JSON.parse(response);
    } catch {
      logger.warn('Ollama returned invalid JSON, attempting extraction', response.substring(0, 200));
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      throw new Error('Could not parse Ollama response as JSON');
    }
  }

  return response;
}

export async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const hasModel = data.models?.some((m) => m.name.startsWith(MODEL.split(':')[0]));
    return hasModel;
  } catch {
    return false;
  }
}
