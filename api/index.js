export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  // Мгновенное приветствие при старте сессии
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
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
    .join('\n');

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'API-ключ не настроен.',
        end_session: false
      }
    });
  }

  const promptText = `Контекст:\n${conversation}\n\nОтветь на последнюю реплику кратко (1-2 предложения), емко для голоса. Без markdown.`;

  // Список моделей по приоритету (если одна перегружена, берется следующая)
  const models = ['gemini-2.5-flash', 'gemini-3.8-flash'];

  async function requestModel(modelName) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: {
        parts: [{ text: 'Ты голосовой ассистент Алиса. Отвечай кратко, без списков и спецсимволов.' }]
      },
      contents: [{
        parts: [{ text: promptText }]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return { ok: response.ok, data };
  }

  try {
    let result = null;

    // Перебираем модели, пока одна не ответит без ошибки перегрузки
    for (const model of models) {
      result = await requestModel(model);
      if (result.ok) break;
      console.warn(`Model ${model} failed, trying next...`);
    }

    if (!result || !result.ok) {
      const msg = result?.data?.error?.message || 'Сервис перегружен.';
      throw new Error(msg);
    }

    const replyText =
      result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось сформировать ответ.';

    history.push({ role: 'assistant', text: replyText });

    return res.status(200).json({
      version,
      session_state: { history: history.slice(-4) },
      response: {
        text: replyText,
        end_session: false
      }
    });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'Сервер сейчас сильно нагружен, повторите вопрос еще раз.',
        end_session: false
      }
    });
  }
}
