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
  const timeoutId = setTimeout(() => controller.abort(), 2600);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Ты Алиса. Ответь кратко в 1 предложение для голоса, без markdown и спецсимволов.' }]
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

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `HTTP ${response.status}`);
    }

    // Читаем потоковые данные до первого законченного фрагмента
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const partText = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (partText) {
              accumulatedText += partText;
            }
          } catch {
            // Пропускаем неполные чанки
          }
        }
      }

      // Как только получено законченное предложение, сразу завершаем чтение
      if (accumulatedText.length > 20 && /[.!?]\s*$/.test(accumulatedText.trim())) {
        reader.cancel();
        break;
      }
    }

    clearTimeout(timeoutId);

    const replyText = accumulatedText.trim() || 'Не удалось сформировать ответ.';
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
    console.error('Stream error:', err);

    return res.status(200).json({
      version,
      session_state: { history },
      response: {
        text: err.name === 'AbortError'
          ? 'Нейросеть отвечает чуть дольше обычного, спросите ещё раз.'
          : `Ошибка: ${err.message.slice(0, 100)}`,
        end_session: false
      }
    });
  }
}
