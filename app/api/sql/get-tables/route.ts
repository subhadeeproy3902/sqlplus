import { NextRequest, NextResponse } from 'next/server'
import { executeUserQuery } from '@/lib/sql-executor'

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json()

    if (!username) {
      return NextResponse.json({
        success: false,
        error: 'Username is required'
      })
    }

    // Use the sanitized schema name for consistency
    const schemaName = username.replace(/[^a-zA-Z0-9_]/g, '_')

    // Get all tables in the user's schema using secure executeUserQuery
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = '${schemaName}'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    const result = await executeUserQuery(username, query)

    if (result.success && result.data) {
      const tables = result.data.map((row: any) => row.table_name)
      return NextResponse.json({
        success: true,
        tables
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to retrieve tables'
      })
    }

  } catch (error) {
    console.error('Get tables error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve tables'
    })
  }
}
