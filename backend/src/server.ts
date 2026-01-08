import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prisma = new PrismaClient();
const port = process.env.PORT || 4000;

// Initialize Gemini client if key provided
let genai: any = null;
if (process.env.GEMINI_API_KEY) {
  genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { userId, subject, company, difficulty } = req.body;
    if (!userId || !subject || !difficulty) return res.status(400).json({ error: 'missing fields' });
    const session = await prisma.session.create({ data: { userId, subject, company, difficulty } });
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/sessions/:id/questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const q = await prisma.question.create({ data: { sessionId: id, text } });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Generate question server-side (calls Gemini if key is present)
app.post('/api/generate-question', async (req, res) => {
  try {
    const { subject, difficulty, previousQuestions = [] } = req.body;
    if (!subject || !difficulty) return res.status(400).json({ error: 'subject & difficulty required' });

    // If no Gemini key available, return a placeholder
    if (!genai) {
      return res.json({ question: `Mock question for ${subject} (${difficulty}) — set GEMINI_API_KEY on server to enable real generation.` });
    }

    const persona = difficulty === 'Beginner' ? 'friendly interviewer for a beginner' : difficulty === 'Intermediate' ? 'professional interviewer for an intermediate candidate' : 'senior-level interviewer assessing an expert candidate';
    let prevContext = '';
    if (previousQuestions && previousQuestions.length > 0) {
      prevContext = '\n\nPreviously asked questions:\n' + previousQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n') + '\n\nDo not repeat these.';
    }

    const prompt = `You are a ${persona}. The topic is '${subject}'. 

IMPORTANT: Ask EXACTLY ONE interview question only. Do not ask multiple questions, sub-questions, or follow-up questions. Do not include any numbering, bullets, introductions, or additional commentary.

CRITICAL: Return ONLY a JSON object with a single property named "question". Example: {"question": "What is ...?"}. Do not include any other text or commentary.${prevContext}`;

    const response = await genai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { temperature: 0.8, maxOutputTokens: 120, responseMimeType: 'application/json' } });
    const raw = (response.text || '').trim();
    
    try {
      const parsed = JSON.parse(raw);
      return res.json(parsed);
    } catch (e) {
      // If parsing fails, attempt to find a valid JSON block within the raw response.
      // This is a robust fallback for cases where the model might still include non-JSON text.
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json(parsed);
        } catch (e2) {
          // If even the extracted JSON is invalid, log the error and fall through.
          console.error('Failed to parse extracted JSON:', e2);
        }
      }
      
      // As a final fallback, treat the raw response as the question if it contains a question mark.
      // This maintains some functionality even with malformed responses.
      if (raw.includes('?')) {
        const question = raw.split('?')[0].trim() + '?';
        return res.json({ question });
      }

      // If no question can be discerned, return a structured error.
      return res.status(500).json({ error: 'Failed to parse a valid question from the model response.' });
    }
  } catch (err) {
    console.error('generate error', err);
    res.status(500).json({ error: 'failed to generate' });
  }
});

app.listen(port, () => console.log(`Backend API listening on http://localhost:${port}`));
