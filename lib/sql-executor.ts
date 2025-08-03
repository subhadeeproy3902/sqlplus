"use server"

import "dotenv/config"
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL
console.log(url) // For debugging purposes, remove in production
if (!url) {
  throw new Error('DATABASE_URL must be set')
}
const sql = neon(url)

export interface QueryResult {
  success: boolean
  data?: any[]
  message?: string
  error?: string
  rowCount?: number
}

// Function to validate that queries only access user's own schema
function validateUserSchemaAccess(query: string, username: string): { isValid: boolean; error?: string } {
  const cleanQuery = query.toLowerCase().trim();
  const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

  // Check for explicit schema references that are not the user's schema
  const schemaPattern = /(\w+)\.(\w+)/g;
  let match;

  while ((match = schemaPattern.exec(cleanQuery)) !== null) {
    const referencedSchema = match[1];
    // Allow information_schema for specific allowed queries (checked later)
    // If the referenced schema is not the user's schema and not information_schema, block it
    if (referencedSchema !== schemaName && referencedSchema !== 'public' && referencedSchema !== 'information_schema') {
      return {
        isValid: false,
        error: `Access denied: Cannot access schema '${referencedSchema}'. You can only access your own schema '${schemaName}'.`
      };
    }
  }

  // Allow specific queries for user's own schema information ONLY
  // The 's' flag is used to allow '.' to match newline characters for multi-line queries
  const allowedSchemaQueries = [
    // Allow user to query their own tables from information_schema
    new RegExp(`information_schema\\.tables.*table_schema\\s*=\\s*'${schemaName}'`, 'is'),
    new RegExp(`information_schema\\.columns.*table_schema\\s*=\\s*'${schemaName}'`, 'is'),
    new RegExp(`information_schema\\.key_column_usage.*table_schema\\s*=\\s*'${schemaName}'`, 'is'),
    new RegExp(`information_schema\\.table_constraints.*table_schema\\s*=\\s*'${schemaName}'`, 'is'),
    // Allow user to query their own tables from pg_tables
    new RegExp(`pg_tables.*schemaname\\s*=\\s*'${schemaName}'`, 'is'),
    new RegExp(`pg_tables.*schemaname\\s*=\\s*'${username}'`, 'is'), // Also allow original username
    // Allow current_schema references (AI agent uses this)
    new RegExp(`information_schema\\.tables.*table_schema\\s*=\\s*current_schema`, 'is'),
    new RegExp(`information_schema\\.columns.*table_schema\\s*=\\s*current_schema`, 'is'),
  ];

  // Check if query contains information_schema or pg_ tables
  if (/information_schema\.|pg_\w+/.test(cleanQuery)) {
    // Check if it's an allowed query for user's own schema
    const isAllowed = allowedSchemaQueries.some(pattern => pattern.test(cleanQuery));
    if (!isAllowed) {
      // Additional check: if it's information_schema.tables with user's schema, allow it
      const userSchemaTableQuery = new RegExp(`information_schema\\.tables.*'${schemaName}'`, 'i');
      if (userSchemaTableQuery.test(cleanQuery)) {
        // This is allowed - user querying their own schema tables
      } else {
        return {
          isValid: false,
          error: 'Access denied: You can only access your own schema information for privacy protection.'
        };
      }
    }
  }

  // Block access to public schema tables
  if (/\bpublic\.\w+/.test(cleanQuery)) {
    return {
      isValid: false,
      error: 'Access denied: Cannot access public schema for privacy protection.'
    };
  }

  return { isValid: true };
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

    // Check if user is trying to access another user's schema
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

    // Validate user schema access FIRST
    const validation = validateUserSchemaAccess(cleanQuery, username);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error || 'Access denied'
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
      if (pattern.test(cleanQuery)) {
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
      const createTemplate = Object.assign([createSchemaQuery], { raw: [createSchemaQuery] })
      await sql(createTemplate as TemplateStringsArray)

      // Schema setup complete - SET search_path will be prepended to user queries below

    } catch (setupError) {
      console.error('Schema setup error:', setupError)
      return {
        success: false,
        error: 'Failed to set up user workspace'
      }
    }

    // Clean up markdown code blocks and other formatting issues BEFORE splitting
    let processedQuery = cleanQuery

    // Remove markdown code blocks
    processedQuery = processedQuery.replace(/```sql\s*/gi, '').replace(/```\s*/g, '')

    // Remove common AI response prefixes/suffixes
    processedQuery = processedQuery.replace(/^(here's|here is|the sql query is|sql query:)/i, '')
    processedQuery = processedQuery.replace(/\n\s*$/g, '') // Remove trailing whitespace

    // MANDATORY: Prepend SET search_path to every user query
    const setPathCommand = `SET search_path TO "${schemaName}"`
    const queryWithPath = `${setPathCommand}; ${processedQuery}`

    // Split the query string into individual statements
    const queries = queryWithPath.split(';').map(q => q.trim()).filter(q => q.length > 0);

    if (queries.length === 0) {
      return {
        success: false,
        error: 'Empty query or only semicolons provided'
      };
    }

    // Use a transaction to ensure all queries are executed in the same session
    const transactionResults = await sql.transaction(async (tx) => {
      let allResults: any[] = [];
      let totalRowCount = 0;
      let messages: string[] = [];

      for (let i = 0; i < queries.length; i++) {
        const singleQuery = queries[i];
        if (singleQuery) { // Ensure query is not empty
          try {
            const queryToExecute = singleQuery.toUpperCase().startsWith('SET') ? singleQuery : `${singleQuery};`;
            const template = Object.assign([queryToExecute], { raw: [queryToExecute] });
            const result = await tx(template as TemplateStringsArray);

            if (Array.isArray(result)) {
              allResults = allResults.concat(result);
              totalRowCount += result.length;
              if (result.length === 0 && !singleQuery.toUpperCase().startsWith('SELECT')) {
                messages.push(`Statement ${i + 1} executed successfully.`);
              } else {
                messages.push(`Statement ${i + 1}: ${result.length} row(s) returned.`);
              }
            } else if (result && typeof result === 'object' && 'command' in result) {
              messages.push(`Statement ${i + 1} (${(result as any).command}) executed successfully.`);
              if ((result as any).rowCount !== null && (result as any).rowCount !== undefined) {
                totalRowCount += (result as any).rowCount;
              }
            } else {
              messages.push(`Statement ${i + 1} executed successfully.`);
            }
          } catch (innerError: unknown) {
            console.error(`SQL execution error in transaction for statement ${i + 1} ("${singleQuery}"):`, innerError);
            let errorMessage = (innerError instanceof Error ? innerError.message : String(innerError)) || 'Unknown error';
            throw new Error(`Error in statement ${i + 1} ("${singleQuery}"): ${errorMessage}`);
          }
        }
      }
      return { allResults, totalRowCount, messages };
    });

    return {
      success: true,
      data: transactionResults.allResults,
      rowCount: transactionResults.totalRowCount,
      message: transactionResults.messages.length > 1
        ? `All ${transactionResults.messages.length} statements executed successfully. ${transactionResults.messages.join(' ')}`
        : transactionResults.messages.join(' ') || 'Query executed successfully.'
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
