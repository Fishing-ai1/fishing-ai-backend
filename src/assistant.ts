// Simple SSE chat stub so the server boots and the frontend chat works.
// You can replace this later with a real OpenAI/Supabase chat handler.

export async function chatStreamHandler(_req: any, reply: any) {
  reply.headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Send a few tokens so the UI shows streaming text
  const chunks = [
    "AI ready. ",
    "Ask me about catches, ramps, or weather. ",
    "We’ll wire the full model next. ",
  ];
  for (const t of chunks) {
    reply.raw.write(`data: ${JSON.stringify({ token: t })}\n\n`);
    await new Promise(r => setTimeout(r, 120));
  }

  // End the stream
  reply.raw.end();
}
