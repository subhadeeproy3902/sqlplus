"use server"

import "dotenv/config"
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL
console.log(url) // For debugging purposes, remove in production
if (!url) {
  throw new Error('DATABASE_URL must be set')
}
const sql = neon(url)

// Helper function to execute dynamic SQL queries with the Neon serverless driver
// This properly handles the tagged template literal requirement
async function executeDynamicSQL(query: string): Promise<any> {
  // Create a proper TemplateStringsArray for the Neon driver
  const templateArray = Object.assign([query], { raw: [query] }) as TemplateStringsArray
  return await sql(templateArray)
}

export interface QueryResult {
  success: boolean
  data?: any[]
  message?: string
  error?: string
  rowCount?: number
}



export async function executeUserQuery(username: string, query: string): Promise<QueryResult> {
  try {
    // Clean and validate the query
    const cleanQuery = query.trim()

    if (!cleanQuery) {
      return {
        success: false,
        error: 'Empty query'
      }
    }

    // Sanitize schema name
    const currentUserName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // Always set search_path to user's schema FIRST (unless already present)
    const hasSearchPath = /SET\s+search_path\s+TO/i.test(cleanQuery);
    let finalQuery = cleanQuery;

    if (!hasSearchPath) {
      // Prepend SET search_path to ensure user can only access their own schema
      finalQuery = `SET search_path TO "${currentUserName}"; ${cleanQuery}`;
    }

    // Check if user is trying to access another user's schema explicitly
    const schemaAccessPattern = /schemaname\s*=\s*['"]([^'"]+)['"]/gi;
    const matches = [...cleanQuery.matchAll(schemaAccessPattern)];

    for (const match of matches) {
      const requestedSchema = match[1];
      if (requestedSchema !== currentUserName) {
        return {
          success: false,
          error: `Access denied: You can only access your own schema '${currentUserName}'. Attempted to access '${requestedSchema}'.`
        }
      }
    }

    // Only block truly dangerous operations
    const dangerousPatterns = [
      /drop\s+database/i,
      /create\s+database/i,
      /drop\s+user/i,
      /create\s+user/i,
      /grant/i,
      /revoke/i,
      // Block access to sensitive system tables
      /pg_authid/i,
      /pg_shadow/i,
      /pg_user/i,
    ]

    // Check for dangerous operations
    for (const pattern of dangerousPatterns) {
      if (pattern.test(finalQuery)) {
        return {
          success: false,
          error: 'Operation not allowed for security reasons'
        }
      }
    }

    // Sanitize schema name (already done above, but keeping for consistency)
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // CRITICAL: Set up complete user isolation
    try {
      // Create user's schema if it doesn't exist
      const createSchemaQuery = `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`
      await executeDynamicSQL(createSchemaQuery)

      // Schema setup complete - SET search_path will be prepended to user queries below

    } catch (setupError) {
      console.error('Schema setup error:', setupError)
      return {
        success: false,
        error: 'Failed to set up user workspace'
      }
    }

    // Clean up markdown code blocks and other formatting issues BEFORE splitting
    let processedQuery = finalQuery

    // Remove markdown code blocks
    processedQuery = processedQuery.replace(/```sql\s*/gi, '').replace(/```\s*/g, '')

    // Remove common AI response prefixes/suffixes
    processedQuery = processedQuery.replace(/^(here's|here is|the sql query is|sql query:)/i, '')
    processedQuery = processedQuery.replace(/\n\s*$/g, '') // Remove trailing whitespace

    // Split the query string into individual statements (finalQuery already has SET search_path)
    const queries = processedQuery.split(';').map(q => q.trim()).filter(q => q.length > 0);

    if (queries.length === 0) {
      return {
        success: false,
        error: 'Empty query or only semicolons provided'
      };
    }

    // Use a transaction in pipeline mode to ensure all queries are executed in the same session.
    // This is the correct way to handle multi-statement execution with the neon serverless driver.
    const results = await sql.transaction(
      queries.map(q => {
        const queryToExecute = q.toUpperCase().startsWith('SET') ? q : `${q};`;
        const templateArray = Object.assign([queryToExecute], { raw: [queryToExecute] }) as TemplateStringsArray;
        return sql(templateArray);
      })
    );

    // Process the results from the transaction pipeline
    let allResults: any[] = [];
    let totalRowCount = 0;
    let hasSelectResults = false;

    results.forEach((result) => {
      if (Array.isArray(result)) {
        // This is a SELECT result with rows
        allResults = allResults.concat(result);
        totalRowCount += result.length;
        if (result.length > 0) {
          hasSelectResults = true;
        }
      } else if (result && typeof result === 'object' && 'command' in result) {
        // This is a command result (INSERT, UPDATE, DELETE, etc.)
        if ((result as any).rowCount !== null && (result as any).rowCount !== undefined) {
          totalRowCount += (result as any).rowCount;
        }
      }
    });

    // Return appropriate message based on query type and results
    let message = '';
    if (hasSelectResults) {
      // For SELECT queries, don't show execution messages, just the data
      message = '';
    } else {
      // For non-SELECT queries (INSERT, UPDATE, DELETE, CREATE, etc.)
      if (totalRowCount > 0) {
        message = `${totalRowCount} row(s) affected.`;
      } else {
        message = 'Query executed successfully.';
      }
    }

    return {
      success: true,
      data: allResults,
      rowCount: totalRowCount,
      message: message
    };

  } catch (error: unknown) {
    console.error('SQL execution error:', error)
    
    // Parse PostgreSQL error messages for better user experience
    let errorMessage = (error instanceof Error ? error.message : String(error)) || 'Unknown error occurred'
    
    // Common PostgreSQL error patterns
    if (errorMessage.includes('syntax error')) {
      errorMessage = 'Syntax error in SQL query'
    } else if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      errorMessage = 'Table or relation does not exist'
    } else if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
      errorMessage = 'Column does not exist'
    } else if (errorMessage.includes('duplicate key')) {
      errorMessage = 'Duplicate key violation'
    } else if (errorMessage.includes('foreign key')) {
      errorMessage = 'Foreign key constraint violation'
    } else if (errorMessage.includes('not null')) {
      errorMessage = 'Not null constraint violation'
    }

    return {
      success: false,
      error: errorMessage
    }
  }
}

export async function formatQueryResult(result: QueryResult): Promise<string> {
  if (!result.success) {
    return `ERROR: ${result.error}`
  }

  if (!result.data || result.data.length === 0) {
    return result.message || 'Query executed successfully'
  }

  // Format table output
  const data = result.data
  const columns = Object.keys(data[0])
  
  // Calculate column widths
  const columnWidths = columns.map(col => {
    const maxDataWidth = Math.max(...data.map(row => String(row[col] || '').length))
    return Math.max(col.length, maxDataWidth, 3) // minimum width of 3
  })

  // Create header
  const header = columns.map((col, i) => col.padEnd(columnWidths[i])).join(' | ')
  const separator = columnWidths.map(width => '-'.repeat(width)).join('-+-')

  // Create rows
  const rows = data.map(row => 
    columns.map((col, i) => String(row[col] || '').padEnd(columnWidths[i])).join(' | ')
  )

  return [header, separator, ...rows, '', `(${data.length} row${data.length !== 1 ? 's' : ''})`].join('\n')
}
