import { generateText } from 'ai'
import { groq } from '@ai-sdk/groq'

// Import the direct functions instead of using fetch for server-side calls
import { executeUserQuery } from './sql-executor'

// Tool execution functions - using direct imports for server-side execution
async function getTablesForUser(username: string) {
  try {
    console.log('Getting tables for user:', username)
    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // Use direct database connection to bypass validation for table discovery
    const { neon } = await import('@neondatabase/serverless')
    const url = process.env.DATABASE_URL
    if (!url) {
      console.error('DATABASE_URL not found')
      return []
    }

    const sql = neon(url)

    // Set search path and get tables
    await sql`SET search_path TO ${schemaName}`
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schemaName}
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    console.log('Query result:', result)
    const tables = result.map((row: any) => row.table_name)
    console.log('Extracted tables:', tables)
    return tables
  } catch (error) {
    console.error('Error getting tables:', error)
    return []
  }
}

async function getTableSchema(username: string, tableName: string) {
  try {
    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // Get columns using information_schema query that will be allowed by our validation
    const columnsQuery = `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_schema = '${schemaName}'
      AND table_name = '${tableName}'
      ORDER BY ordinal_position
    `

    const columnsResult = await executeUserQuery(username, columnsQuery)

    if (!columnsResult.success) {
      return null
    }

    return {
      tableName,
      columns: columnsResult.data || [],
      primaryKeys: [], // Simplified for now
      foreignKeys: [], // Simplified for now
      indexes: [] // Simplified for now
    }
  } catch (error) {
    return null
  }
}

async function executeSQLQuery(username: string, query: string) {
  return await executeUserQuery(username, query)
}

// Main AI agent function
export async function generateSQLWithAgent(username: string, prompt: string) {
  try {
    console.log('AI Agent starting for user:', username, 'prompt:', prompt)

    // Step 1: Get user's tables
    const tables = await getTablesForUser(username)
    console.log('Found tables:', tables)

    if (tables.length === 0) {
      console.log('No tables found for user:', username)
      return {
        success: false,
        error: 'No tables found in your schema. Please create some tables first.',
        explanation: 'The AI agent could not find any tables in your database schema.',
        sqlQuery: null
      }
    }

    // Step 2: Analyze which tables might be relevant - simplified approach
    let filteredRelevantTables: string[]

    // Simple keyword matching for table relevance
    const promptLower = prompt.toLowerCase()
    filteredRelevantTables = tables.filter(table => {
      const tableLower = table.toLowerCase()
      // Check if table name appears in prompt or if prompt contains common keywords
      return promptLower.includes(tableLower) ||
             promptLower.includes('all') ||
             promptLower.includes('show') ||
             promptLower.includes('table')
    })

    // If no specific tables found, use all tables (limited to 3 for performance)
    if (filteredRelevantTables.length === 0) {
      filteredRelevantTables = tables.slice(0, 3)
    } else {
      filteredRelevantTables = filteredRelevantTables.slice(0, 3)
    }
    // Step 3: Get schemas for relevant tables
    const tableSchemas = await Promise.all(
      filteredRelevantTables.map(async (tableName) => {
        const schema = await getTableSchema(username, tableName)
        return { tableName, schema }
      })
    )

    const validSchemas = tableSchemas.filter(item => item.schema !== null)

    // Step 4: Generate SQL with full context
    let sqlQuery: string

    try {
      const sqlResult = await generateText({
        model: groq('llama-3.1-70b-versatile'), // Use stable model
        prompt: `You are an expert PostgreSQL assistant. Generate ONLY the SQL query for this request.

USER REQUEST: "${prompt}"

AVAILABLE TABLES: ${filteredRelevantTables.join(', ')}

TABLE SCHEMAS:
${validSchemas.map(item => `
Table: ${item.tableName}
Columns: ${item.schema?.columns?.map((col: any) => `${col.column_name} (${col.data_type})`).join(', ') || 'No columns found'}
`).join('\n')}

CRITICAL RULES:
1. Generate ONLY the SQL query - no explanations, no markdown, no code blocks
2. Only use the tables listed above: ${filteredRelevantTables.join(', ')}
3. Use PostgreSQL syntax
4. Do NOT include schema prefixes in table names
5. For CREATE TABLE statements, use simple table names
6. Use appropriate data types: VARCHAR(255), INTEGER, SERIAL PRIMARY KEY, BOOLEAN, TIMESTAMP, etc.
7. End with a single semicolon

SQL Query:`
      })

      sqlQuery = sqlResult.text.trim()

      // Clean up the response - remove markdown code blocks and extra text
      sqlQuery = sqlQuery.replace(/```sql\s*/gi, '').replace(/```\s*/g, '')

      // Remove common AI response patterns
      sqlQuery = sqlQuery.replace(/^(here's|here is|the sql query is|sql query:)/i, '')
      sqlQuery = sqlQuery.replace(/^(based on|looking at)/i, '')

      const lines = sqlQuery.split('\n')
      const sqlLines = lines.filter(line => {
        const trimmedLine = line.trim()
        return trimmedLine.length > 0 &&
               !trimmedLine.toLowerCase().includes('here') &&
               !trimmedLine.toLowerCase().includes('query') &&
               !trimmedLine.startsWith('--') // Remove comments
      })
      sqlQuery = sqlLines.join('\n').trim()

      // Remove any trailing semicolons and re-add a single one
      sqlQuery = sqlQuery.replace(/;+$/, '') + ';'

    } catch (error) {
      throw new Error(`Failed to generate SQL: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // Step 5: Validate and execute the query
    const executionResult = await executeSQLQuery(username, sqlQuery)

    return {
      success: true,
      sqlQuery,
      executionResult
    }

  } catch (error) {
    console.error('AI Agent Error:', error)
    return {
      success: false,
      error: 'AI agent failed to process request',
      explanation: error instanceof Error ? error.message : 'Unknown error occurred',
      sqlQuery: null
    }
  }
}
