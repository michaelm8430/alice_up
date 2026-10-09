export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  // Приветствие при старте сессии
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

  const conversation = history
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
    .join('\n');

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'Ошибка: API-ключ GEMINI_API_KEY не задан в Vercel Settings -> Environments.',
        end_session: false
      }
    });
  }

  const promptText = `Контекст разговора:\n${conversation}\n\nОтветь на последнюю реплику пользователя.`;

  // Функция запроса к Gemini API
  async function callGemini(useSearch = true) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const payload = {
      system_instruction: {
        parts: [{
          text: 'Ты голосовой ассистент для умной колонки Алиса. Отвечай кратко (2-3 емких предложения), живо, без списков, жирного шрифта и Markdown-разметки.'
        }]
      },
      contents: [{
        parts: [{ text: promptText }]
      }]
    };

    if (useSearch) {
      payload.tools = [{ googleSearch: {} }];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return { ok: response.ok, data };
  }

  try {
    // 1. Пробуем запрос с поиском Google
    let resData = await callGemini(true);

    // 2. Если Google вернул ошибку из-за поиска, пробуем чистый запрос
    if (!resData.ok) {
      console.warn('Search tool failed, retrying without search:', resData.data);
      resData = await callGemini(false);
    }

    if (!resData.ok) {
      const errDetail = resData.data?.error?.message || JSON.stringify(resData.data);
      throw new Error(errDetail);
    }

    const replyText =
      resData.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось сформировать ответ.';

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
    console.error('Final Catch Error:', err);
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: `Ошибка модели: ${err.message.slice(0, 150)}`,
        end_session: false
      }
    });
  }
}
