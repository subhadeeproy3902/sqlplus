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

    // Check for dangerous operations that could affect other users
    const dangerousPatterns = [
      new RegExp(`drop\\s+schema\\s+(?!.*\\b${username}\\b)`, 'i'),
      new RegExp(`create\\s+schema\\s+(?!.*\\b${username}\\b)`, 'i'),
      new RegExp(`alter\\s+schema\\s+(?!.*\\b${username}\\b)`, 'i'),
      /drop\s+database/i,
      /create\s+database/i,
      /drop\s+user/i,
      /create\s+user/i,
      /grant/i,
      /revoke/i
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(cleanQuery)) {
        return {
          success: false,
          error: 'Operation not allowed'
        }
      }
    }

    // Execute schema setup and user query separately (Neon doesn't allow multiple commands)
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_') // Sanitize schema name

    // First, create schema if it doesn't exist
    const createSchemaTemplate = Object.assign([`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`], { raw: [`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`] })
    await sql(createSchemaTemplate as TemplateStringsArray)

    // Set search path to user schema
    const setPathTemplate = Object.assign([`SET search_path TO "${schemaName}"`], { raw: [`SET search_path TO "${schemaName}"`] })
    await sql(setPathTemplate as TemplateStringsArray)

    // Execute the user query
    const userQueryTemplate = Object.assign([cleanQuery], { raw: [cleanQuery] })
    const result = await sql(userQueryTemplate as TemplateStringsArray)
    
    // Handle different types of results
    if (Array.isArray(result)) {
      return {
        success: true,
        data: result,
        rowCount: result.length,
        message: result.length === 0 ? 'Query executed successfully (no rows returned)' : `${result.length} row(s) returned`
      }
    } else {
      return {
        success: true,
        data: [],
        message: 'Query executed successfully'
      }
    }
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
