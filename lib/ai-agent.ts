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
    const setPathTemplate = Object.assign([`SET search_path TO "${schemaName}"`], { raw: [`SET search_path TO "${schemaName}"`] })
    await sql(setPathTemplate as TemplateStringsArray)

    const tablesTemplate = Object.assign([`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `], { raw: [`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = '${schemaName}'
      ORDER BY tablename
    `] })
    const result = await sql(tablesTemplate as TemplateStringsArray)

    console.log('Query result:', result)
    const tables = result.map((row: any) => row.tablename)
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
        model: groq('meta-llama/llama-4-scout-17b-16e-instruct'), // Use stable model
        prompt: `You are an expert PostgreSQL assistant. Your primary function is to generate SQL queries based on user requests.

SPECIAL TOOL INSTRUCTION: If the user asks to see, show, or list their tables, you MUST respond with the exact text: USE_SHOW_TABLES_TOOL

USER REQUEST: "${prompt}"

AVAILABLE TABLES: ${filteredRelevantTables.join(', ')}

TABLE SCHEMAS:
${validSchemas.map(item => `
Table: ${item.tableName}
Columns: ${item.schema?.columns?.map((col: any) => `${col.column_name} (${col.data_type})`).join(', ') || 'No columns found'}
`).join('\n')}

CRITICAL RULES:
1. **Follow the SPECIAL TOOL INSTRUCTION above.** If the user wants to see their tables, respond with USE_SHOW_TABLES_TOOL and nothing else.
2. For all other requests, generate ONLY the SQL query - no explanations, no markdown, no code blocks.
3. Only use the tables listed above: ${filteredRelevantTables.join(', ')}
4. Use PostgreSQL syntax.
5. Do NOT include schema prefixes in table names.
6. For CREATE TABLE statements, use simple table names.
7. Use appropriate data types: VARCHAR(255), INTEGER, SERIAL PRIMARY KEY, BOOLEAN, TIMESTAMP, etc.
8. End with a single semicolon.

Your Response:`
      })

      sqlQuery = sqlResult.text.trim()

      // Check if the AI wants to use the custom tool
      if (sqlQuery === 'USE_SHOW_TABLES_TOOL') {
        console.log('AI requested to use SHOW_TABLES_TOOL. Executing predefined query.')
        const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')
        sqlQuery = `
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = '${schemaName}'
          ORDER BY tablename;
        `
      } else {
        // If not using the tool, clean up the generated SQL as before
        sqlQuery = sqlQuery.replace(/```sql\s*/gi, '').replace(/```\s*/g, '');
        sqlQuery = sqlQuery.replace(/^(here's|here is|the sql query is|sql query:)/i, '');
        sqlQuery = sqlQuery.replace(/^(based on|looking at)/i, '');

        const lines = sqlQuery.split('\n');
        const sqlLines = lines.filter(line => {
          const trimmedLine = line.trim();
          return trimmedLine.length > 0 &&
                 !trimmedLine.toLowerCase().includes('here') &&
                 !trimmedLine.toLowerCase().includes('query') &&
                 !trimmedLine.startsWith('--');
        });
        sqlQuery = sqlLines.join('\n').trim();
        sqlQuery = sqlQuery.replace(/;+$/, '') + ';';
      }

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
