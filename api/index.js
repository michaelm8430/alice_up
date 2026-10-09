export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  // Приветствие при старте
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: 'Ошибка: API ключ Gemini не настроен в Vercel.',
        end_session: false
      }
    });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const bodyData = {
      system_instruction: {
        parts: [{
          text: 'Ты голосовой ассистент для умной колонки Алиса. Отвечай кратко (максимум 2-3 емких предложения), понятно для озвучки голосом. Не используй списки, жирный шрифт и Markdown-символы.'
        }]
      },
      contents: [{
        parts: [{ text: conversation }]
      }],
      tools: [{ google_search: {} }]
    };

    const apiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error('Google API Error Response:', JSON.stringify(data));
      throw new Error(data?.error?.message || 'Gemini API Error');
    }

    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось получить ответ, попробуйте еще раз.';

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
    console.error('Catch Error:', err);
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
