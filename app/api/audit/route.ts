import { NextResponse } from 'next/server';
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod';

// Define the expected payload schema strictly
const AuditPayloadSchema = z.object({
  repoUrl: z.string().url(),
  caseFileText: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    // 1. Intercept & Validate the BYOK (Bring Your Own Key)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing or invalid API Key' },
        { status: 401 }
      );
    }
    const userApiKey = authHeader.split(' ')[1];

    // 2. Parse and Validate the incoming JSON payload
    const body = await request.json();
    const parsedBody = AuditPayloadSchema.safeParse(body);
    
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Bad Request: Invalid payload structure' },
        { status: 400 }
      );
    }

    const { repoUrl, caseFileText } = parsedBody.data;

    // 3. Dynamically Initialize Genkit per-request
    // This ensures isolation: one session's key never contaminates another's.
    const ai = genkit({
      plugins: [googleAI({ apiKey: userApiKey })],
      model: 'gemini-2.0-flash', 
    });

    // 4. Construct the Remote Auditor Context
    const systemPrompt = `You are a strict SRE and security auditor. 
    Analyze the repository at ${repoUrl}. 
    ${caseFileText ? `Focus specifically on the breakpoint provided in this case file: \n${caseFileText}` : 'Perform a broad static intelligence sweep and logical flow analysis.'}
    Return your findings in a structured JSON format.`;

    // 5. Execute the Reasoning Engine
    const { text } = await ai.generate({
      prompt: systemPrompt,
      config: {
        temperature: 0.1, // Keep hallucination strictly low for security audits
      }
    });

    // 6. Return the stateless response
    return NextResponse.json({
      status: "SUCCESS",
      target: repoUrl,
      auditResult: text,
    });

  } catch (error) {
    console.error('[DRIFT_ENGINE] Audit Execution Failed:', error);
    return NextResponse.json(
      { error: 'Internal Server Error during audit execution.' },
      { status: 500 }
    );
  }
}