export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  // Мгновенный ответ на приветствие при старте сессии
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

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(200).json({
      version,
      session_state: state?.session || {},
      response: {
        text: 'API-ключ не настроен в Vercel.',
        end_session: false
      }
    });
  }

  const history = state?.session?.history || [];
  history.push({ role: 'user', text: userText });

  const promptText = history
    .slice(-3)
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
    .join('\n');

  // Список моделей: сначала более свободная gemini-2.5-flash, затем gemini-3.8-flash
  const models = ['gemini-2.5-flash', 'gemini-3.8-flash'];

  async function queryGemini(modelName, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Ты голосовой помощник Алиса. Отвечай кратко: 1-2 предложения, просто и понятно для голоса, без markdown.' }]
        },
        contents: [{
          parts: [{ text: promptText }]
        }],
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0.7
        }
      })
    });
    const data = await response.json();
    return { ok: response.ok && !data.error, data };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2600);

  try {
    let replyText = null;

    for (const model of models) {
      try {
        const result = await queryGemini(model, controller.signal);
        if (result.ok) {
          replyText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (replyText) break;
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
    }

    clearTimeout(timeoutId);

    if (!replyText) {
      replyText = 'Сервис нейросети сейчас сильно загружен. Попробуйте повторить вопрос через секунду.';
    }

    history.push({ role: 'assistant', text: replyText });

    return res.status(200).json({
      version,
      session_state: { history: history.slice(-3) },
      response: {
        text: replyText,
        end_session: false
      }
    });
  } catch (err) {
    clearTimeout(timeoutId);
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'Нейросеть отвечает дольше обычного. Пожалуйста, повторите вопрос еще раз.',
        end_session: false
      }
    });
  }
}
