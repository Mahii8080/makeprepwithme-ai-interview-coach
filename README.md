<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MakePrepWithMe: AI Interview Coach

This repository contains the full source code for MakePrepWithMe, an AI-powered interview and exam preparation platform.

## Features
- **AI Mentors**: Interactive SVG-based avatars with lip-sync.
- **Voice Interaction**: Speech-to-text and text-to-speech for realistic interviews.
- **Gemini AI**: Powered by Google's Gemini models for question generation and evaluation.
- **Advanced Mode**: Webcam-based proctoring and non-verbal feedback.
- **Personalized Learning**: Track progress and performance across various subjects.

## Run Locally

### Frontend
1. Install dependencies:
   `npm install`
2. Set your `VITE_GEMINI_API_KEY` in `.env.local`.
3. Start the development server:
   `npm run dev`

### Backend
1. Go to the `backend` directory.
2. Install dependencies:
   `npm install`
3. Set your `GEMINI_API_KEY` and `DATABASE_URL` in `.env`.
4. Run Prisma migrations or generate the client:
   `npx prisma generate`
5. Start the backend:
   `npm run dev`

