export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is alive');
  }

  const { request, session, state, version = '1.0' } = req.body || {};
  const userText = request?.command || request?.original_utterance || '';

  // Приветствие при старте новой сессии
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

  // Считываем предыдущую историю диалога из сессии
  const rawHistory = state?.session?.history || [];
  
  // Добавляем текущее сообщение пользователя
  const updatedHistory = [...rawHistory, { role: 'user', text: userText }];

  // Формируем историю для Gemini в правильном формате ролей (user / model)
  // Берем последние 4 сообщения, чтобы не раздувать запрос и сохранять скорость
  const recentHistory = updatedHistory.slice(-4);
  const contents = recentHistory.map(item => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.text }]
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ 
            text: 'Ты голосовой помощник Алиса. Помни весь контекст предыдущих реплик диалога. Отвечай кратко: 1-2 простых предложения для озвучки голосом. Без списков, markdown и спецсимволов.' 
          }]
        },
        contents: contents,
        generationConfig: {
          maxOutputTokens: 90,
          temperature: 0.6
        }
      })
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    }

    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Не удалось получить ответ.';

    // Сохраняем ответ модели в историю
    updatedHistory.push({ role: 'assistant', text: replyText });

    return res.status(200).json({
      version,
      // Возвращаем обновленную историю в Яндекс Диалоги
      session_state: { history: updatedHistory.slice(-4) },
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
      session_state: { history: updatedHistory },
      response: {
        text: err.name === 'AbortError'
          ? 'Нейросеть отвечает чуть дольше обычного, повторите вопрос.'
          : `Ошибка: ${err.message.slice(0, 100)}`,
        end_session: false
      }
    });
  }
}
