import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai'
import { getUserSchemaInfo, formatSchemaForAI } from './schema-introspection'

export interface PromptHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIQueryResult {
  success: boolean
  sqlQuery?: string
  explanation?: string
  error?: string
}

export async function generateSQLFromPrompt(
  username: string,
  prompt: string,
  history?: PromptHistoryItem[],
  previousError?: string,
  previousQuery?: string
): Promise<AIQueryResult> {
  try {
    // API Key Check for Groq
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.trim() === '') {
      return {
        success: false,
        error: 'Groq API key not configured. Please set GROQ_API_KEY in your environment variables.'
      };
    }

    // Instantiate Groq client
    const groq = createGroq();

    // Get the user's database schema
    const schemaInfo = await getUserSchemaInfo(username)
    const schemaDescription = formatSchemaForAI(schemaInfo)

    const messages: PromptHistoryItem[] = [];
    if (history) {
      messages.push(...history);
    }
    messages.push({ role: 'user', content: prompt });
    
    // System prompt should not contain the user's latest question if using messages array
    let baseSystemPrompt = `You are Mastra AI, an expert PostgreSQL SQL query generator. Your only job is to convert natural language questions into valid PostgreSQL queries.

Database Schema Information (User-Specific Schema):
${schemaDescription}

PRIVACY AND SECURITY REQUIREMENTS:
- You can ONLY access tables in the user's private schema shown above
- NEVER reference other schemas, system tables, or public tables
- DO NOT use schema prefixes (e.g., schema.table) in your queries
- All table references should be unqualified (just table names)
- The user's data is completely isolated from other users

Instructions:
1. Output only the SQL query. Do not include explanations, markdown formatting, or any extra text.
2. Use PostgreSQL syntax.
3. Follow the schema exactly. If a requested table or column is missing, return only a SQL comment like -- Query cannot be formed due to missing schema elements.
4. Use double quotes for case-sensitive or special character names.
5. Select only the columns requested or required. Do not use SELECT * unless explicitly asked.
6. Include necessary clauses like WHERE, JOIN, GROUP BY, ORDER BY, LIMIT as needed.
7. If the request is too ambiguous, return -- Request is too ambiguous to generate a query.
8. Default to SELECT unless the user explicitly asks for insert, update, delete, or create.
9. Only output the correct SQL code, nothing before or after.
10. NEVER attempt to access system tables, information_schema, pg_catalog, or any other user's data.`;

    // If there's a previous error, modify the prompt to include error correction context
    if (previousError && previousQuery) {
      baseSystemPrompt += `

ERROR CORRECTION MODE:
The previous query failed with this error: "${previousError}"
The failed query was: "${previousQuery}"

Please analyze the error and generate a corrected version of the query that addresses the specific error. Common fixes include:
- Fixing syntax errors
- Using correct table/column names from the schema
- Adjusting data types
- Fixing constraint violations
- Correcting JOIN conditions

Generate only the corrected SQL query.`;
    }


    const result = await generateText({
      model: groq('meta-llama/llama-4-scout-17b-16e-instruct'), // Using Llama3 8b model with Groq
      system: baseSystemPrompt,       // System instructions
      messages: messages,             // History + current prompt
      maxTokens: 4096,
      temperature: 0.1, // Low temperature for more consistent results
    })

    const generatedText = result.text.trim()

    console.log('Generated SQL:', generatedText)
    
    // Basic validation to ensure it looks like SQL
    if (!generatedText.toLowerCase().includes('select') && 
        !generatedText.toLowerCase().includes('insert') && 
        !generatedText.toLowerCase().includes('update') && 
        !generatedText.toLowerCase().includes('delete') &&
        !generatedText.toLowerCase().includes('create') &&
        !generatedText.toLowerCase().includes('drop') &&
        !generatedText.toLowerCase().includes('alter')) {
      return {
        success: false,
        error: 'AI did not generate a valid SQL query. The response might be an explanation or error message.',
        explanation: generatedText
      }
    }

    // Clean up the query (remove any markdown formatting that might have slipped through)
    let sqlQuery = generatedText
      .replace(/```sql/gi, '')
      .replace(/```/g, '')
      .trim()
    
    // Ensure the query ends with a semicolon
    if (!sqlQuery.endsWith(';')) {
      sqlQuery += ';'
    }

    return {
      success: true,
      sqlQuery,
      explanation: `AI generated SQL query for: "${prompt}"`
    }
  } catch (error) {
    console.error('AI SQL generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate SQL query'
    }
  }
}

export function isAICommand(input: string): boolean {
  return input.trim().toLowerCase().startsWith('/ai ')
}

export function extractAIPrompt(input: string): string {
  return input.trim().substring(4).trim() // Remove '/ai ' prefix
}

// New function for conversational AI-database workflow with error handling
export async function generateSQLWithErrorHandling(
  username: string,
  prompt: string,
  history?: PromptHistoryItem[],
  maxRetries: number = 2
): Promise<AIQueryResult & { retryCount?: number }> {
  let retryCount = 0;
  let lastError: string | undefined;
  let lastQuery: string | undefined;

  while (retryCount <= maxRetries) {
    try {
      // Generate SQL query (with error context if this is a retry)
      const result = await generateSQLFromPrompt(username, prompt, history, lastError, lastQuery);

      if (!result.success) {
        return { ...result, retryCount };
      }

      // For now, return the query without dry run testing since we need to implement that in the API
      // The error handling will happen when the query is actually executed
      return { ...result, retryCount };

    } catch (error) {
      return {
        success: false,
        error: `Error in AI-database conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        retryCount
      };
    }
  }

  return {
    success: false,
    error: 'Maximum retries exceeded',
    retryCount
  };
}
