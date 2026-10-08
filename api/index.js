import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
if (req.method !== 'POST') {
return res.status(200).send('Webhook is alive');
}

const { request, session, state, version = '1.0' } = req.body;
const userText = request?.command request?.original_utterance '';

// При первом запуске навыка приветствуем пользователя
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

// Извлекаем предыдущую историю диалога из сессии
const history = state?.session?.history || [];
history.push({ role: 'user', text: userText });

// Формируем плоский контекст последних сообщений
const chatContext = history
.slice(-6)
.map(m => ${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text})
.join('\n');

try {
const response = await ai.models.generateContent({
model: 'gemini-2.5-flash',
contents: chatContext,
config: {
// Включаем нативный поиск Google без внешних API
tools: [{ googleSearch: {} }],
systemInstruction: Ты голосовой ассистент для умной колонки Алиса.
Отвечай естественно, уверенно и кратко: максимум 2-3 емких предложения.
Избегай Markdown-разметки (звездочек, решеток, списков), пиши чистый текст для озвучки.
}
});

const replyText = response.text?.trim() || 'Не удалось сформировать ответ, попробуйте еще раз.';

history.push({ role: 'assistant', text: replyText });

return res.status(200).json({
version,
session_state: {
history: history.slice(-6) // держим в памяти последние реплики
},
response: {
text: replyText,
end_session: false
}
});
} catch (err) {
console.error('Gemini API Error:', err);
return res.status(200).json({
version,
session_state: { history },
response: {
text: 'Произошла ошибка при связи с моделью. Попробуй позже.',
end_session: false
}
});
}
}
