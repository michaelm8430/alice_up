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
        text: 'API-ключ не настроен.',
        end_session: false
      }
    });
  }

  const history = state?.session?.history || [];
  history.push({ role: 'user', text: userText });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Ты Алиса. Отвечай ультра-кратко: ровно 1 предложение, без markdown.' }]
        },
        contents: [{
          parts: [{ text: userText }]
        }],
        generationConfig: {
          maxOutputTokens: 60,
          temperature: 0.5
        }
      })
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'API error');
    }

    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось получить ответ.';

    history.push({ role: 'assistant', text: replyText });

    return res.status(200).json({
      version,
      session_state: { history: history.slice(-2) },
      response: {
        text: replyText,
        end_session: false
      }
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error:', err);

    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: err.name === 'AbortError' 
          ? 'Сеть ответила слишком медленно. Спросите еще раз.' 
          : `Ошибка: ${err.message.slice(0, 100)}`,
        end_session: false
      }
    });
  }
}
