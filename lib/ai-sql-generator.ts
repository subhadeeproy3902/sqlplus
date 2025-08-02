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
  history?: PromptHistoryItem[]
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
    const baseSystemPrompt = `You are Mastra AI, an expert PostgreSQL SQL query generator. Your only job is to convert natural language questions into valid PostgreSQL queries.  

Database Schema Information:  
${schemaDescription}  

Instructions:  
1. Output only the SQL query. Do not include explanations, markdown formatting, or any extra text.  
2. Use PostgreSQL syntax.  
3. Follow the schema exactly. If a requested table or column is missing, return only a SQL comment like -- Query cannot be formed due to missing schema elements.  
4. Use double quotes for case-sensitive or special character names.  
5. Select only the columns requested or required. Do not use SELECT * unless explicitly asked.  
6. Include necessary clauses like WHERE, JOIN, GROUP BY, ORDER BY, LIMIT as needed.  
7. If the request is too ambiguous, return -- Request is too ambiguous to generate a query.  
8. Default to SELECT unless the user explicitly asks for insert, update, delete, or create.  
9. Only output the correct SQL code, nothing before or after.`;


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
