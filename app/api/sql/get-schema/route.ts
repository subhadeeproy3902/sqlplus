import { NextRequest, NextResponse } from 'next/server'
import { executeUserQuery } from '@/lib/sql-executor'

export async function POST(request: NextRequest) {
  try {
    const { username, tableName } = await request.json()

    if (!username || !tableName) {
      return NextResponse.json({
        success: false,
        error: 'Username and table name are required'
      })
    }

    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // Get table schema with columns, data types, constraints using secure executeUserQuery
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
      return NextResponse.json({
        success: false,
        error: columnsResult.error || 'Failed to retrieve table columns'
      })
    }

    // Get primary keys using secure executeUserQuery
    const primaryKeysQuery = `
      SELECT column_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = '${schemaName}'
      AND tc.table_name = '${tableName}'
      AND tc.constraint_type = 'PRIMARY KEY'
    `
    const primaryKeysResult = await executeUserQuery(username, primaryKeysQuery)

    // Get foreign keys using secure executeUserQuery
    const foreignKeysQuery = `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = '${schemaName}'
      AND tc.table_name = '${tableName}'
      AND tc.constraint_type = 'FOREIGN KEY'
    `
    const foreignKeysResult = await executeUserQuery(username, foreignKeysQuery)

    const schema = {
      tableName,
      columns: columnsResult.data || [],
      primaryKeys: primaryKeysResult.success ? (primaryKeysResult.data || []).map((row: any) => row.column_name) : [],
      foreignKeys: foreignKeysResult.success ? (foreignKeysResult.data || []) : [],
      indexes: [] // Simplified for now since pg_indexes requires special handling
    }

    return NextResponse.json({
      success: true,
      schema
    })

  } catch (error) {
    console.error('Get schema error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve table schema'
    })
  }
}
