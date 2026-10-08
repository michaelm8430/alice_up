import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  if (session?.new && !userText) {
    return res.status(200).json({
      version,
      session_state: { history: [] },
      response: {
        text: 'Привет! Я на связи. О чём поговорим?',
        end_session: false
      }
    });
  }

  const history = state?.session?.history || [];
  history.push({ role: 'user', text: userText });

  const chatContext = history
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
    .join('\n');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatContext,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: `Ты голосовой ассистент для умной колонки Алиса.
Отвечай естественно, уверенно и кратко: максимум 2-3 емких предложения.
Избегай Markdown-разметки (звездочек, решеток, списков), пиши чистый текст для озвучки.`
      }
    });

    const replyText = response.text?.trim() || 'Не удалось сформировать ответ, попробуйте еще раз.';
    history.push({ role: 'assistant', text: replyText });

    return res.status(200).json({
      version,
      session_state: { history: history.slice(-6) },
      response: {
        text: replyText,
        end_session: false
      }
    });
  } catch (err) {
    console.error('Gemini API Error:', err);
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'Произошла ошибка при обращении к модели. Попробуй позже.',
        end_session: false
      }
    });
  }
}
