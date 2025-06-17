import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { getUserSchemaInfo, formatSchemaForAI } from './schema-introspection'

export interface AIQueryResult {
  success: boolean
  sqlQuery?: string
  explanation?: string
  error?: string
}

export async function generateSQLFromPrompt(username: string, prompt: string): Promise<AIQueryResult> {
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return {
        success: false,
        error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in your environment variables.'
      }
    }

    // Get the user's database schema
    const schemaInfo = await getUserSchemaInfo(username)
    const schemaDescription = formatSchemaForAI(schemaInfo)
    
    // Create the system prompt
    const systemPrompt = `You are an expert SQL query generator. Your task is to convert natural language questions into valid PostgreSQL queries.

Database Schema Information:
${schemaDescription}

Rules:
1. Generate ONLY valid PostgreSQL SQL queries
2. Use proper table and column names as shown in the schema
3. Always use double quotes around table names and column names if they contain special characters
4. For SELECT queries, be specific about which columns to return unless "all" is requested
5. Use appropriate WHERE clauses, JOINs, GROUP BY, ORDER BY as needed
6. If the request is ambiguous, make reasonable assumptions based on the schema
7. If the request cannot be fulfilled with the available schema, explain why
8. Do not include any markdown formatting or code blocks in your response
9. Return only the SQL query, nothing else

User's Question: ${prompt}`

    const result = await generateText({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      prompt: `Generate a SQL query for: ${prompt}`,
      maxTokens: 500,
      temperature: 0.1, // Low temperature for more consistent results
    })

    const generatedText = result.text.trim()
    
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
