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
  const allowedSchemaQueries = [
    // Allow user to query their own tables from information_schema
    new RegExp(`information_schema\\.tables.*table_schema\\s*=\\s*'${schemaName}'`, 'i'),
    new RegExp(`information_schema\\.columns.*table_schema\\s*=\\s*'${schemaName}'`, 'i'),
    new RegExp(`information_schema\\.key_column_usage.*table_schema\\s*=\\s*'${schemaName}'`, 'i'),
    new RegExp(`information_schema\\.table_constraints.*table_schema\\s*=\\s*'${schemaName}'`, 'i'),
    // Allow user to query their own tables from pg_tables
    new RegExp(`pg_tables.*schemaname\\s*=\\s*'${schemaName}'`, 'i'),
    new RegExp(`pg_tables.*schemaname\\s*=\\s*'${username}'`, 'i'), // Also allow original username
    // Allow current_schema references (AI agent uses this)
    new RegExp(`information_schema\\.tables.*table_schema\\s*=\\s*current_schema`, 'i'),
    new RegExp(`information_schema\\.columns.*table_schema\\s*=\\s*current_schema`, 'i'),
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

    // MANDATORY: Prepend SET search_path to every user query.
    // This is executed as a single transaction to ensure the search_path is set
    // for the user's query, which is critical in a stateless serverless environment.
    const setPathCommand = `SET search_path TO "${schemaName}";`
    const finalQuery = `${setPathCommand} ${processedQuery}`

    // Execute the combined query
    const queryTemplate = Object.assign([finalQuery], { raw: [finalQuery] });
    const result = await sql(queryTemplate as TemplateStringsArray);

    let message = 'Query executed successfully.';
    if (Array.isArray(result)) {
      if (result.length === 0 && !processedQuery.toUpperCase().includes('SELECT')) {
        message = `Command executed successfully.`;
      } else {
        message = `${result.length} row(s) returned.`;
      }
    } else if (result && typeof result === 'object' && 'command' in result) {
      message = `Command (${(result as any).command}) executed successfully.`;
    }

    return {
      success: true,
      data: Array.isArray(result) ? result : [],
      rowCount: Array.isArray(result) ? result.length : (result as any).rowCount || 0,
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
