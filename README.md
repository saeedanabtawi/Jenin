# Jenin AI mock Interviewer 

1. Jenin – The Resilient Guide

Personality traits:

Confident & professional – speaks clearly, gives precise advice, inspires trust.

Motivational – encourages users to push through challenges and tough interviews.

Knowledgeable & structured – provides well-organized feedback and resources.

Empowering – helps users see their potential and “grow like a sprout,” tying to the city meaning.

Voice / Tone:

Calm, authoritative, yet approachable.

Uses phrases like: “You’ve got this. Let’s tackle this question step by step.”

Can sound like a mentor from a prestigious university or career coach.

Best for:

Users who want serious guidance and structure.

Branding that emphasizes Palestinian pride and resilience.


## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running Locally](#running-locally)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Testing](#testing)
- [Build](#build)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Overview

- Jenin AI mock Interviewer is a voice-first mock interview coach. It conducts realistic interviews, transcribes user speech via Speech-to-Text (STT), reasons over responses with a Large Language Model (LLM), and replies with natural Text-to-Speech (TTS).
- Persona: The Resilient Guide — confident, motivational, structured, and empowering. Voice is calm and authoritative yet approachable. Favorite line: “You’ve got this. Let’s tackle this question step by step.”
- Architecture principles: modular, provider-agnostic adapters for STT/LLM/TTS; privacy-first by design; optional local/offline support depending on chosen providers.

## Tech Stack

Core components (Express backend; provider-agnostic STT/LLM/TTS):

- STT: Whisper API / Vosk / Deepgram / Google Cloud STT (selectable)
- LLM: OpenAI / Anthropic / local models via Ollama (selectable)
- TTS: ElevenLabs / Coqui TTS / Azure TTS (selectable)
- Backend API: Express (Node.js) REST
- Realtime: WebSocket/Socket.IO for live transcription and low latency
- Storage (optional): Local JSON/SQLite for transcripts, rubrics, and session logs
- Client (optional): Web client (Next.js/Vite) and/or CLI
- Infra (optional): Docker for reproducible dev and deployment

## Features

- Realistic, role-based mock interviews (configurable role, domain, and difficulty)
- Live transcription (interim + final) with timestamps
- LLM-driven follow-ups, scoring with rubrics, and actionable feedback
- Natural voice responses with adjustable voice, speed, and emotion
- Session artifacts: full transcript, score breakdown, improvement plan, and resources
- Extensible provider adapters for STT/LLM/TTS; swap without changing business logic
- Privacy options: local-only mode when using local models/tools

## Project Structure

Planned layout (adjust as code is added):

```
Jenin/
├─ backend/                   # Express API server
│  ├─ src/
│  │  ├─ routes/              # HTTP routes
│  │  ├─ services/            # Provider adapters
│  │  │  ├─ stt/
│  │  │  ├─ llm/
│  │  │  └─ tts/
│  │  ├─ middlewares/
│  │  ├─ utils/
│  │  └─ index.ts|js          # App entry
│  ├─ package.json
│  └─ tsconfig.json           # if using TypeScript
├─ client/                    # Optional web client (Next.js/Vite)
├─ data/                      # Prompts, rubrics, sample questions, saved sessions
├─ tests/                     # Test suite
├─ scripts/                   # Dev/CI scripts
├─ .env.example               # Example environment configuration
├─ README.md
└─ LICENSE
```

## Getting Started

### Prerequisites

- Git
- Node.js (LTS) and npm/pnpm/yarn
- Optional: Docker for containerized dev/deploy

### Installation

1) Clone the repository
```bash
git clone <this-repo-url>
cd Jenin
```

2) Backend (Express) setup
```bash
# if using backend/ subdir (per structure)
cd backend || true
npm install
# or: pnpm install / yarn install
```

3) Optional Web Client
```bash
cd client
npm install
```

### Running Locally

- Backend API (Express)
```bash
npm run dev --prefix backend
# or: node backend/src/index.js
```

- Optional Web Client
```bash
npm run dev --prefix client
```

## Configuration

- Copy `.env.example` to `.env` and fill in the values relevant to your chosen providers.
- Suggested variables:
  - General: `PORT`, `ENV`, `LOG_LEVEL`
  - STT: `STT_PROVIDER`, `STT_API_KEY`, `STT_LANGUAGE`
  - LLM: `LLM_PROVIDER`, `OPENAI_API_KEY` (or provider-specific), `LLM_MODEL`
  - TTS: `TTS_PROVIDER`, `TTS_API_KEY`, `TTS_VOICE`
  - Storage (optional): `DATABASE_URL` or path to local storage

## Scripts

Planned common scripts (Express backend):

- `dev`: Start Express in dev mode (e.g., `nodemon src/index.js`) in `backend/package.json`
- `test`: Run unit tests (e.g., `jest` or `vitest`) for backend
- `lint`: Run `eslint .` and `prettier --check .`
- `build` (optional if TS): `tsc -p .`
- `client:dev`: Start the web client (`npm run dev --prefix client`)

## Testing

Backend (Node.js):
```bash
npm test --prefix backend
```

Client (optional):
```bash
npm test --prefix client
```

## Build

Examples:

- Docker (Express backend):
  ```bash
  docker build -t jenin-express-backend:latest -f docker/Dockerfile.backend .
  ```
- Backend TypeScript build (optional):
  ```bash
  npm run build --prefix backend
  ```
- Client build:
  ```bash
  npm run build --prefix client
  ```

## Deployment

Options (pick what fits your stack):

- Containerized: Push Docker image to a registry, deploy to Fly.io/Render/Heroku/Kubernetes
- Node process manager on a VM/server: PM2 or systemd to keep the Express app running
- Static client hosting on Netlify/Vercel + API on a separate host

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit changes: `git commit -m "feat: add your feature"`
4. Push and open a PR

Adopt a conventional commits style if you prefer: `feat:`, `fix:`, `docs:`, etc.

## License

Specify your license (e.g., MIT). Add a `LICENSE` file at the project root.

## Acknowledgments

- Branding inspired by Palestinian resilience and growth.
- Thanks to the open-source STT/TTS/LLM communities and provider SDKs.
- Contributors and reviewers who improve this project over time.

