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

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2400);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Ты голосовой помощник Алиса. Отвечай кратко: 1-2 предложения, просто и понятно для голоса, без markdown.' }]
        },
        contents: [{
          parts: [{ text: promptText }]
        }]
      })
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    // Если Google вернул ошибку, сразу показываем её текст в ответе
    if (!response.ok || data.error) {
      const errorMsg = data.error?.message || JSON.stringify(data);
      return res.status(200).json({
        version,
        session_state: { history },
        response: {
          text: `Ошибка от Google: ${errorMsg.slice(0, 180)}`,
          end_session: false
        }
      });
    }

    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Ответ пустой.';

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
    console.error('Request error:', err);
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: `Сбой запроса: ${err.message?.slice(0, 150)}`,
        end_session: false
      }
    });
  }
}
