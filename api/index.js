export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  // Мгновенный ответ на приветствие без обращения к нейросети
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

  const conversation = history
    .slice(-3)
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
    .join('\n');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2400); // прерываем, если нейросеть думает дольше 2.4 сек

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: 'Ты голосовой помощник Алиса. Отвечай кратко: 1-2 простых предложения для озвучки, без форматирования и markdown.' }]
        },
        contents: [{
          parts: [{ text: conversation }]
        }],
        generationConfig: {
          maxOutputTokens: 120,
          temperature: 0.7
        }
      })
    });

    clearTimeout(timeoutId);

    const data = await response.json();
    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось получить ответ, попробуйте спросить иначе.';

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
    console.error('API Error:', err);

    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'Сервер думал слишком долго. Спросите, пожалуйста, ещё раз.',
        end_session: false
      }
    });
  }
}
