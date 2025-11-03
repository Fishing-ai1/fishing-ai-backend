@echo off
cd /d C:\Users\morat\FishingAI\fishing-ai-backend
echo Starting Fishing AI backend...
call pnpm exec tsx src\server.ts
pause
