// src/lib/genkit.ts
import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';

// Initialize the core system
export const ai = genkit({
  plugins: [googleAI()],
  model: 'gemini-2.0-flash', 
});

// Define the core flow logic here, NOT the server logic
export const securityAuditFlow = ai.defineFlow(
  { 
    name: 'securityAudit', 
    inputSchema: z.object({
      repoUrl: z.string().url(),
      caseFileText: z.string().optional() // For your optional Static Intelligence upload
    }),
    outputSchema: z.object({
      status: z.string(),
      vulnerabilities: z.array(z.string())
    })
  },
  async (input) => {
    // In the future, MCP + GitHub API calls go here.
    // For now, we mock the reasoning engine.
    const prompt = `Perform a remote security audit on ${input.repoUrl}. 
                    ${input.caseFileText ? `Focus on this case file: ${input.caseFileText}` : ''}`;
    
    const { text } = await ai.generate(prompt);
    
    return {
      status: "Audit Complete",
      vulnerabilities: [text] 
    };
  }
);