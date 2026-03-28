import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Generate a trivia question for the given topic and difficulty.
// Returns { question, answer, variants } where variants includes answer + alternates.
export async function generateQuestion(topic, difficulty = 'medium', language = 'English') {
  const difficultyGuide = {
    easy: 'suitable for general audiences, well-known facts',
    medium: 'moderately challenging, requires some knowledge',
    hard: 'challenging, requires specific knowledge',
  };

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Generate a trivia question about: ${topic}
Difficulty: ${difficulty} (${difficultyGuide[difficulty] || difficultyGuide.medium})
Language: Write the question and all answers in ${language}.

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation:
{"question":"...","answer":"...","variants":["..."]}

Rules:
- variants must include the canonical answer as first element
- 2-4 total variants covering common ways to express the answer
- answer should be concise (1-5 words ideally)
- question must be unambiguous and have exactly one correct answer`,
    }],
  });

  // Extract the first {...} block from the response, tolerating any surrounding text
  const raw = message.content[0].text;
  console.log(`[ai] raw response: ${raw.slice(0, 200)}`);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in AI response');
  const parsed = JSON.parse(match[0]);
  return {
    question: parsed.question,
    answer: parsed.answer,
    variants: parsed.variants.map(v => v.toLowerCase().trim()),
  };
}
