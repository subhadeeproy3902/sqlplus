import { createGroq } from '@ai-sdk/groq';
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
    
    // Create the system prompt
    const systemPrompt = `You are Mastra AI, an expert PostgreSQL SQL query generator. Your primary function is to convert natural language questions into accurate and executable PostgreSQL queries.

You will be provided with Database Schema Information. Adhere strictly to this schema.

Database Schema Information:
${schemaDescription}

Key Instructions:
1.  **Output Format:** Generate ONLY the SQL query. Do NOT include any explanations, markdown formatting (like \`\`\`sql), or any text other than the SQL query itself.
2.  **PostgreSQL Syntax:** Ensure all generated queries are valid for PostgreSQL.
3.  **Schema Adherence:** Use only the table and column names exactly as provided in the schema. If a requested operation involves tables or columns not in the schema, you MUST indicate that the query cannot be formed, but do so by returning a SQL comment like '-- Query cannot be formed due to missing schema elements.' instead of conversational text.
4.  **Quoting:** Use double quotes for table and column names if they contain special characters or are case-sensitive and require it. For example, "myTable" or "columnName".
5.  **Specificity:** For SELECT queries, retrieve only the columns explicitly asked for or those essential for the query's context. Avoid using \`SELECT *\` unless "all columns" is specifically requested.
6.  **Completeness:** Include necessary SQL clauses like WHERE, JOIN, GROUP BY, ORDER BY, LIMIT, etc., to accurately fulfill the user's request.
7.  **Ambiguity:** If a request is ambiguous, make the most reasonable interpretation based on the schema. If critical information is missing and a reasonable assumption cannot be made, return a SQL comment like '-- Request is too ambiguous to generate a query.'
8.  **No DML by Default:** Unless the user's prompt explicitly asks to modify or add data (e.g., "insert", "update", "delete", "create table"), assume the query should be a SELECT statement.
9.  **Error Handling (within AI context):** If you cannot generate a query, do not explain in natural language. Instead, return a SQL comment explaining the issue (e.g., \`-- The requested information is not available in the provided schema.\`).

The user's question will be provided last. Focus solely on translating it to a PostgreSQL query based on these instructions.
User's Question: ${prompt}`
    // The user's question is embedded in the systemPrompt above.
    // Thus, the 'prompt' field for generateText should be empty.

    const result = await generateText({
      model: groq('llama3-8b-8192'), // Using Llama3 8b model with Groq
      system: systemPrompt, // The existing refined system prompt
      prompt: '', // User's question is in systemPrompt
      maxTokens: 500,
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
