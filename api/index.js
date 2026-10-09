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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2700);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Ты голосовой помощник Алиса. Отвечай кратко: 1-2 простых предложения для озвучки голосом. Без списков и спецсимволов.' }]
        },
        contents: [{
          parts: [{ text: userText }]
        }],
        generationConfig: {
          maxOutputTokens: 80,
          temperature: 0.6
        }
      })
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok || data.error) {
      const errMsg = data?.error?.message || 'Ошибка сервиса';
      throw new Error(errMsg);
    }

    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось получить ответ.';

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
    console.error('Model call error:', err);

    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: err.name === 'AbortError'
          ? 'Нейросеть отвечает чуть дольше обычного, спросите ещё раз.'
          : 'Сервер сейчас под нагрузкой, повторите запрос.',
        end_session: false
      }
    });
  }
}
